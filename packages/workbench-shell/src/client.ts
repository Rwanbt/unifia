/* SPDX-License-Identifier: MIT */

import {
  EVENT_MERGE_RULES,
  WIRE_PROTOCOL_VERSION,
  createIdempotencyKey,
  parseHandshakeResponse,
  parseTokenRotation,
  parseWorkspaceEvent,
  type HandshakeResponse,
  type IdempotencyKey,
  type OpaqueCursor,
  type TokenRotation,
  type WorkbenchEventType,
  type WorkspaceEvent,
} from "@unifia/contracts/workbench-wire"
import { createNativeTokenProvider, type NativeTokenBridge, type NativeTokenRequest } from "./native-token-bridge.js"

export type TokenProvider = {
  current(): string | undefined
  refresh(): Promise<string>
  applyRotation?(rotation: TokenRotation): void
}

export type WorkbenchClientOptions = {
  baseUrl: string
  instanceId: string
  token: TokenProvider
  fetchImpl?: typeof fetch
  now?: () => number
}

export type WorkbenchConnectionOptions = Omit<WorkbenchClientOptions, "instanceId" | "token"> & {
  bridge: NativeTokenBridge
  tokenRequest: NativeTokenRequest
}

export type WorkbenchConnection = {
  client: WorkbenchClient
  instanceId: string
  workspaceId: string
  revoke(): Promise<void>
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  idempotencyKey?: IdempotencyKey
  signal?: AbortSignal
}

export type WorkspaceFileEntry = { path: string; kind: "file" | "directory"; size: number; modifiedAt: number }
export type WorkspaceFilePage = { entries: readonly WorkspaceFileEntry[] }
export type ArtifactSummary = { artifactId: string; version: number; kind: string; filename: string; bytes: number; createdAt: number; metadata: Record<string, string>; provenance?: Record<string, string> }
export type AuditEvent = { sequence: number; timestamp: number; actor: string; capability: string; decision: "allow" | "deny" | "approval_required"; previousHash: string; hash: string }
export type AuditPage = { kind: "trace" | "activity"; events: readonly AuditEvent[]; nextCursor: number | null }
export type ApprovalRequest = { id: string; capability: string; resource: string; expiresAt: number; status: "pending" | "allow" | "deny" | "cancelled" }
export type CapabilityRecord = { manifest: { descriptor: { id: string; name: string; description: string; version: string; author: string; license: string; schema: Record<string, unknown>; tags: string[]; trustLevel: "untrusted" | "verified" | "official" }; digest: string; sourceRepo: string; sourceCommit: string; license: string; attribution?: string; remoteCode: boolean; signature?: string }; state: "registered" | "approved" | "enabled" | "revoked" }
export type ExportedArtifact = { artifactId: string; version: number; relativePath: string; sha256: string; metadata: Record<string, string> }

export class WorkbenchHttpError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(status: number, retryable: boolean) {
    super(`workbench request failed: ${status}`)
    this.name = "WorkbenchHttpError"
    this.status = status
    this.retryable = retryable
  }
}

type EventListener = (event: WorkspaceEvent) => void

/** Merges the single SSE stream into one observable state per workspace. */
export class WorkbenchEventDispatcher {
  readonly #listeners = new Set<EventListener>()
  readonly #replace = new Map<WorkbenchEventType, WorkspaceEvent>()
  readonly #lastWins = new Map<WorkbenchEventType, WorkspaceEvent>()
  readonly #appendOnly: WorkspaceEvent[] = []
  #workspaceId: string | undefined
  #lastSequence = 0
  #resyncRequired = false

  get lastSequence(): number { return this.#lastSequence }
  get resyncRequired(): boolean { return this.#resyncRequired }
  get events(): readonly WorkspaceEvent[] { return [...this.#appendOnly, ...this.#replace.values(), ...this.#lastWins.values()] }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  apply(value: unknown): WorkspaceEvent {
    const event = parseWorkspaceEvent(value)
    if (this.#workspaceId && this.#workspaceId !== event.workspaceId) throw new Error("event workspace does not match dispatcher")
    this.#workspaceId = event.workspaceId
    if (event.sequenceId > this.#lastSequence + 1) this.#resyncRequired = true
    this.#lastSequence = Math.max(this.#lastSequence, event.sequenceId)
    const rule = EVENT_MERGE_RULES[event.type]
    if (rule === "append-only") this.#appendOnly.push(event)
    else if (rule === "replace") this.#replace.set(event.type, event)
    else if (rule === "last-wins" || rule === "state-snapshot") this.#lastWins.set(event.type, event)
    for (const listener of this.#listeners) listener(event)
    return event
  }

  markResynced(sequence: number, cursor?: OpaqueCursor): void {
    if (!Number.isInteger(sequence) || sequence < 0) throw new Error("invalid resync sequence")
    this.#lastSequence = sequence
    this.#resyncRequired = false
    void cursor
  }
}

/** Typed transport with fail-closed retries: mutant POSTs never replay implicitly. */
export class WorkbenchClient {
  readonly #baseUrl: string
  readonly #instanceId: string
  readonly #token: TokenProvider
  readonly #fetch: typeof fetch
  readonly #now: () => number
  #rotation: Promise<void> | undefined

  constructor(options: WorkbenchClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "")
    this.#instanceId = options.instanceId
    this.#token = options.token
    this.#fetch = options.fetchImpl ?? fetch
    this.#now = options.now ?? (() => Date.now())
  }

  async handshake(): Promise<HandshakeResponse> {
    const response = await this.#fetch(`${this.#baseUrl}/v1/handshake`, {
      method: "POST",
      headers: { ...this.#headers(), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "workbench.handshake",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        supportedVersions: [WIRE_PROTOCOL_VERSION],
        clientInstanceId: this.#instanceId,
      }),
    })
    const payload = await response.json()
    return parseHandshakeResponse(payload)
  }

  /**
   * Applies a native rotation before allowing another request to leave the
   * client. The native provider remains the only token owner; this method only
   * serializes the handoff so concurrent requests cannot race the transition.
   */
  applyTokenRotation(value: unknown): TokenRotation {
    const rotation = parseTokenRotation(value)
    if (this.#token.applyRotation) {
      this.#rotation = Promise.resolve()
        .then(() => this.#token.applyRotation?.(rotation))
        .then(() => undefined)
        .finally(() => { this.#rotation = undefined })
    }
    return rotation
  }

  async listFiles(workspaceId: string, prefix = ".", signal?: AbortSignal): Promise<WorkspaceFilePage> {
    const params = new URLSearchParams({ workspaceId, prefix })
    return this.request<WorkspaceFilePage>(`/v1/files/list?${params}`, { signal })
  }

  async searchFiles(workspaceId: string, query: string, prefix = ".", signal?: AbortSignal): Promise<WorkspaceFilePage> {
    const params = new URLSearchParams({ workspaceId, query, prefix })
    return this.request<WorkspaceFilePage>(`/v1/files/search?${params}`, { signal })
  }

  async listArtifacts(workspaceId: string, signal?: AbortSignal): Promise<{ artifacts: readonly ArtifactSummary[] }> {
    return this.request(`/v1/artifacts?${new URLSearchParams({ workspaceId })}`, { signal })
  }

  async listDocuments(workspaceId: string, signal?: AbortSignal): Promise<{ documents: readonly ArtifactSummary[] }> {
    return this.request(`/v1/documents?${new URLSearchParams({ workspaceId })}`, { signal })
  }

  async trace(workspaceId: string, after = 0, limit = 50, signal?: AbortSignal): Promise<AuditPage> {
    const params = new URLSearchParams({ workspaceId, after: String(after), limit: String(limit) })
    return this.request<AuditPage>(`/v1/trace?${params}`, { signal })
  }

  async activity(workspaceId: string, after = 0, limit = 50, signal?: AbortSignal): Promise<AuditPage> {
    const params = new URLSearchParams({ workspaceId, after: String(after), limit: String(limit) })
    return this.request<AuditPage>(`/v1/activity?${params}`, { signal })
  }

  async listApprovals(workspaceId: string, signal?: AbortSignal): Promise<{ approvals: readonly ApprovalRequest[] }> {
    return this.request(`/v1/approvals?${new URLSearchParams({ workspaceId })}`, { signal })
  }

  async searchCapabilities(workspaceId: string, filters: { tag?: string; trustLevel?: "untrusted" | "verified" | "official"; enabledOnly?: boolean } = {}, signal?: AbortSignal): Promise<{ records: readonly CapabilityRecord[] }> {
    const params = new URLSearchParams({ workspaceId })
    if (filters.tag) params.set("tag", filters.tag)
    if (filters.trustLevel) params.set("trustLevel", filters.trustLevel)
    if (filters.enabledOnly !== undefined) params.set("enabledOnly", String(filters.enabledOnly))
    return this.request(`/v1/capabilities/search?${params}`, { signal })
  }

  async exportArtifact(workspaceId: string, artifactId: string, options: { outbox?: string; metadata?: "keep" | "strip" } = {}, signal?: AbortSignal): Promise<{ exported: ExportedArtifact }> {
    return this.request(`/v1/artifacts/export`, { method: "POST", body: { workspaceId, artifactId, ...options }, idempotencyKey: newRequestId(), signal })
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    await this.#rotation
    const method = options.method ?? "GET"
    const canRetry = method === "GET" || method === "DELETE" || options.idempotencyKey !== undefined
    let token = this.#token.current()
    let response = await this.#send(path, method, token, options)
    if (response.status === 401 && canRetry) {
      token = await this.#token.refresh()
      response = await this.#send(path, method, token, options)
    }
    if (!response.ok) throw new WorkbenchHttpError(response.status, response.status === 429 || response.status >= 500)
    return (await response.json()) as T
  }

  async *events(workspaceId: string, dispatcher: WorkbenchEventDispatcher, signal?: AbortSignal): AsyncGenerator<WorkspaceEvent> {
    const cursor = dispatcher.lastSequence > 0 ? `?after=${encodeURIComponent(String(dispatcher.lastSequence))}` : ""
    const response = await this.#fetch(`${this.#baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/events${cursor}`, { method: "GET", headers: { ...this.#headers(), accept: "text/event-stream" }, signal })
    if (!response.ok || !response.body) throw new WorkbenchHttpError(response.status, response.status >= 500)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const frames = buffer.split("\n\n")
        buffer = frames.pop() ?? ""
        for (const frame of frames) {
          const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
          if (!data) continue
          const event = dispatcher.apply(JSON.parse(data))
          yield event
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  #headers(token = this.#token.current()): Record<string, string> {
    return { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-unifia-instance-id": this.#instanceId, "x-unifia-client-time": String(this.#now()) }
  }

  #send(path: string, method: RequestOptions["method"], token: string | undefined, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { ...this.#headers(token), ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}) }
    return this.#fetch(`${this.#baseUrl}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal })
  }
}

/** Creates the live client only after the native lease and server identity agree. */
export async function connectWorkbench(options: WorkbenchConnectionOptions): Promise<WorkbenchConnection> {
  const adapted = await createNativeTokenProvider(options.bridge, options.tokenRequest)
  const token = adapted.provider.current()
  if (!token) throw new Error("native bridge returned no current token")
  const client = new WorkbenchClient({ ...options, instanceId: adapted.instanceId, token: adapted.provider })
  const handshake = await client.handshake()
  if (!handshake.accepted || handshake.instanceId !== adapted.instanceId) {
    await adapted.revoke()
    throw new Error("workbench server identity mismatch")
  }
  return { client, instanceId: adapted.instanceId, workspaceId: adapted.workspaceId, revoke: adapted.revoke }
}

export function newRequestId(now = Date.now()): IdempotencyKey {
  return createIdempotencyKey(now)
}
