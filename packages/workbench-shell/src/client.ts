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
  type WorkbenchRequestHeader,
  type WorkspaceEvent,
} from "@unifia/contracts/workbench-wire"
import type { WorkspaceManifest } from "@unifia/contracts"
import { createNativeTokenProvider, type NativeTokenBridge, type NativeTokenRequest } from "./native-token-bridge.js"
import { WorkbenchCleanupError } from "./lifecycle.js"
import {
  M6_SERVER_ROUTE_REGISTRY,
  M7_SERVER_ROUTE_REGISTRY,
  M8_SERVER_ROUTE_REGISTRY,
  M9A_SERVER_ROUTE_REGISTRY,
  M9B_SERVER_ROUTE_REGISTRY,
  M10_SERVER_ROUTE_REGISTRY,
  M11_SERVER_ROUTE_REGISTRY,
  M15_SERVER_ROUTE_REGISTRY,
  M20_SERVER_ROUTE_REGISTRY,
  WORKBENCH_ROUTE_REGISTRY,
} from "./routes.js"

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
  serverOrigin: string
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
// FUNC-004/C5-1: nextCursor is opaque and bound server-side to the
// workspaceId + prefix that produced it; round-trip it back into
// listFiles() unmodified to fetch the next page. skipped counts entries
// omitted because they resolved outside the workspace root (a
// symlink/junction escape) — the listing still completes.
export type WorkspaceFilePage = { entries: readonly WorkspaceFileEntry[]; nextCursor?: string; skipped: number }
export type WorkspaceFileRead = { path: string; content: string; encoding: "utf-8" | "base64" }
export type ArtifactSummary = { artifactId: string; version: number; kind: string; filename: string; bytes: number; createdAt: number; metadata: Record<string, string>; provenance?: Record<string, string> }
export type ArtifactDocument = { artifact: ArtifactSummary; content: string; encoding: "base64" }
export type AcceptedOperation = { accepted: true; operationId: string; approvalId?: string | null }
export type ApprovalDecision = { decision: { kind: "allow" | "deny" | "approval_required"; [key: string]: unknown } }
export type WorkflowState = { workflowId: string; status: string; [key: string]: unknown }
export type WorkflowStartResult = { state: WorkflowState } | { approvalRequired: true; approvalId: string; capability: string }
export type DesignSpecValidation = { valid: boolean; spec: unknown; capabilities: { granted: readonly string[]; denied: readonly string[] } }
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

  async handshake(signal?: AbortSignal): Promise<HandshakeResponse> {
    const response = await this.#fetch(`${this.#baseUrl}/v1/handshake`, {
      method: "POST",
      headers: { ...this.#headers(), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "workbench.handshake",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        supportedVersions: [WIRE_PROTOCOL_VERSION],
        clientInstanceId: this.#instanceId,
      }),
      signal,
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

  async listFiles(workspaceId: string, prefix = ".", cursor?: string, signal?: AbortSignal): Promise<WorkspaceFilePage> {
    const params = new URLSearchParams({ workspaceId, prefix, ...(cursor ? { cursor } : {}) })
    return this.request<WorkspaceFilePage>(`${M7_SERVER_ROUTE_REGISTRY.filesList.route}?${params}`, { signal })
  }

  async searchFiles(workspaceId: string, query: string, prefix = ".", signal?: AbortSignal): Promise<WorkspaceFilePage> {
    const params = new URLSearchParams({ workspaceId, query, prefix })
    return this.request<WorkspaceFilePage>(`${M7_SERVER_ROUTE_REGISTRY.filesSearch.route}?${params}`, { signal })
  }

  async readFiles(workspaceId: string, paths: readonly string[], signal?: AbortSignal): Promise<{ results: readonly WorkspaceFileRead[] }> {
    return this.request(WORKBENCH_ROUTE_REGISTRY.files.route, { method: WORKBENCH_ROUTE_REGISTRY.files.method, body: { workspaceId, paths }, idempotencyKey: newRequestId(), signal })
  }

  async listDesignSystems(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceManifest> {
    return this.request<WorkspaceManifest>(`${M20_SERVER_ROUTE_REGISTRY.designSystems.route}?${new URLSearchParams({ workspaceId })}`, { signal })
  }

  async listArtifacts(workspaceId: string, signal?: AbortSignal): Promise<{ artifacts: readonly ArtifactSummary[] }> {
    return this.request(`${M9A_SERVER_ROUTE_REGISTRY.artifactsList.route}?${new URLSearchParams({ workspaceId })}`, { signal })
  }

  async getArtifact(workspaceId: string, artifactId: string, signal?: AbortSignal): Promise<ArtifactDocument> {
    const params = new URLSearchParams({ workspaceId })
    const route = M9A_SERVER_ROUTE_REGISTRY.artifactDetail.route.replace(":artifactId", encodeURIComponent(artifactId))
    return this.request<ArtifactDocument>(`${route}?${params}`, { signal })
  }

  async createArtifact(input: { workspaceId: string; kind: string; filename: string; content: string; artifactId?: string; metadata?: Record<string, string>; provenance?: Record<string, string> }, signal?: AbortSignal): Promise<{ artifact: ArtifactSummary }> {
    return this.request(M9B_SERVER_ROUTE_REGISTRY.artifactCreate.route, { method: "POST", body: input, idempotencyKey: newRequestId(), signal })
  }

  async listDocuments(workspaceId: string, signal?: AbortSignal): Promise<{ documents: readonly ArtifactSummary[] }> {
    return this.request(`${WORKBENCH_ROUTE_REGISTRY.documents.route}?${new URLSearchParams({ workspaceId })}`, { signal })
  }

  async trace(workspaceId: string, after = 0, limit = 50, signal?: AbortSignal): Promise<AuditPage> {
    const params = new URLSearchParams({ workspaceId, after: String(after), limit: String(limit) })
    return this.request<AuditPage>(`${M8_SERVER_ROUTE_REGISTRY.tracePage.route}?${params}`, { signal })
  }

  async activity(workspaceId: string, after = 0, limit = 50, signal?: AbortSignal): Promise<AuditPage> {
    const params = new URLSearchParams({ workspaceId, after: String(after), limit: String(limit) })
    return this.request<AuditPage>(`${M8_SERVER_ROUTE_REGISTRY.activityPage.route}?${params}`, { signal })
  }

  async listApprovals(workspaceId: string, signal?: AbortSignal): Promise<{ approvals: readonly ApprovalRequest[] }> {
    return this.request(`${M8_SERVER_ROUTE_REGISTRY.approvalsList.route}?${new URLSearchParams({ workspaceId })}`, { signal })
  }

  async searchCapabilities(workspaceId: string, filters: { tag?: string; trustLevel?: "untrusted" | "verified" | "official"; enabledOnly?: boolean } = {}, signal?: AbortSignal): Promise<{ records: readonly CapabilityRecord[] }> {
    const params = new URLSearchParams({ workspaceId })
    if (filters.tag) params.set("tag", filters.tag)
    if (filters.trustLevel) params.set("trustLevel", filters.trustLevel)
    if (filters.enabledOnly !== undefined) params.set("enabledOnly", String(filters.enabledOnly))
    return this.request(`${M15_SERVER_ROUTE_REGISTRY.capabilitySearch.route}?${params}`, { signal })
  }

  async exportArtifact(workspaceId: string, artifactId: string, options: { outbox?: string; metadata?: "keep" | "strip" } = {}, signal?: AbortSignal): Promise<{ exported: ExportedArtifact } | AcceptedOperation> {
    return this.request(M10_SERVER_ROUTE_REGISTRY.artifactExport.route, { method: "POST", body: { workspaceId, artifactId, ...options }, idempotencyKey: newRequestId(), signal })
  }

  // No registry entry exists for /v1/approvals/:id (M8_SERVER_ROUTE_REGISTRY
  // only declares the plain listing route) or for /v1/workflows/* — adding
  // one for routes nothing else references would be speculative, so these
  // stay literal until a real registry entry exists.
  async resolveApproval(approvalId: string, decision: "allow" | "deny", signal?: AbortSignal): Promise<ApprovalDecision> {
    return this.request(`/v1/approvals/${encodeURIComponent(approvalId)}`, { method: "POST", body: { decision }, idempotencyKey: newRequestId(), signal })
  }

  async cancelApproval(approvalId: string, signal?: AbortSignal): Promise<ApprovalDecision> {
    return this.request(`/v1/approvals/${encodeURIComponent(approvalId)}`, { method: "DELETE", idempotencyKey: newRequestId(), signal })
  }

  async startWorkflow(workspaceId: string, definition: Record<string, unknown>, signal?: AbortSignal): Promise<WorkflowStartResult> {
    return this.request(`/v1/workflows/start`, { method: "POST", body: { workspaceId, definition }, idempotencyKey: newRequestId(), signal })
  }

  async validateSpec(workspaceId: string, spec: string | Record<string, unknown>, signal?: AbortSignal): Promise<DesignSpecValidation> {
    return this.request(M11_SERVER_ROUTE_REGISTRY.specValidate.route, { method: "POST", body: { workspaceId, spec }, signal })
  }

  async updateWorkflow(workflowId: string, action: "resume" | "cancel", signal?: AbortSignal): Promise<{ state: WorkflowState }> {
    return this.request(`/v1/workflows/${action}`, { method: "POST", body: { workflowId }, idempotencyKey: newRequestId(), signal })
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
    const route = M6_SERVER_ROUTE_REGISTRY.workspaceEvents.route.replace(":workspaceId", encodeURIComponent(workspaceId))
    const response = await this.#fetch(`${this.#baseUrl}${route}${cursor}`, { method: "GET", headers: { ...this.#headers(), accept: "text/event-stream" }, signal })
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

  // Typed against WorkbenchRequestHeader (the single header allowlist shared
  // with the server's access-control-allow-headers, see @unifia/contracts):
  // an undeclared header name here is a type error, not a runtime CORS
  // failure discovered later (FUNC-002).
  #headers(token = this.#token.current()): Partial<Record<WorkbenchRequestHeader, string>> {
    return { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-unifia-instance-id": this.#instanceId, "x-unifia-client-time": String(this.#now()) }
  }

  #send(path: string, method: RequestOptions["method"], token: string | undefined, options: RequestOptions): Promise<Response> {
    const headers: Partial<Record<WorkbenchRequestHeader, string>> = { ...this.#headers(token), ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}) }
    return this.#fetch(`${this.#baseUrl}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal })
  }
}

/** Creates the live client only after the native lease and server identity agree. */
export async function connectWorkbench(options: WorkbenchConnectionOptions): Promise<WorkbenchConnection> {
  let adapted: Awaited<ReturnType<typeof createNativeTokenProvider>> | undefined
  try {
    adapted = await createNativeTokenProvider(options.bridge, options.tokenRequest)
    const token = adapted.provider.current()
    if (!token) throw new Error("native bridge returned no current token")
    const client = new WorkbenchClient({ ...options, instanceId: adapted.instanceId, token: adapted.provider })
    const handshake = await client.handshake()
    if (!handshake.accepted || handshake.instanceId !== adapted.instanceId) throw new Error("workbench server identity mismatch")
    return { client, serverOrigin: new URL(options.baseUrl).origin, instanceId: adapted.instanceId, workspaceId: adapted.workspaceId, revoke: adapted.revoke }
  } catch (primary) {
    if (!adapted) throw primary
    try {
      await adapted.revoke()
    } catch (cleanup) {
      throw new WorkbenchCleanupError(primary, cleanup)
    }
    throw primary
  }
}

export function newRequestId(now = Date.now()): IdempotencyKey {
  return createIdempotencyKey(now)
}
