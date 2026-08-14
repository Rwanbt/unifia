import type { ApprovalBroker, ApprovalRequestRecord, AuditEvent, CapabilityRegistry, BrowserAutomationBroker, McpUiControlBroker, UiAction, CapabilityManifest, DesktopAutomationBroker, WorkspaceManifest } from "@unifia/contracts"
/* SPDX-License-Identifier: MIT */
import type { MemoryRuntime } from "@unifia/memory-runtime"
import type { WorkflowDefinition, WorkflowRuntime } from "@unifia/workflow-runtime"
import type { ArtifactStore } from "@unifia/artifact-runtime"
import { parseSpec, resolveEffectiveCapabilities } from "@unifia/spec-runtime"
import type { SkillRegistry } from "@unifia/skill-hub"
import { renderGenerativeUi, type UiNode } from "@unifia/contracts"
import { WIRE_PROTOCOL_VERSION, parseHandshakeRequest } from "@unifia/contracts/workbench-wire"
import type {
  FileReadResult,
  FileWrite,
  P3Capability,
  RuntimeAdapter,
  WorkspaceHandle,
  WorkspacePort,
} from "@unifia/contracts"
import { migrateWorkspaceManifest, WORKSPACE_MANIFEST_PATH } from "@unifia/contracts"

import { randomUUID } from "node:crypto"
import { FixedWindowRateLimiter, principalCanOpen, principalCanRegister, type Principal, type PrincipalAuthenticator, type RateLimiter, type ScopedToken, type ScopedTokenAuthority, type ScopedTokenRequest } from "./auth.js"
import { OperationRegistry } from "./operations.js"
import { addSecurityHeaders, checkRequestOrigin } from "./security.js"

export * from "./auth.js"
export * from "./security.js"
export * from "./operations.js"
export * from "./logging.js"

type AuditPort = { record(actor: string, capability: string, decision: "allow" | "deny" | "approval_required"): unknown; page?: (afterSequence: number, limit: number) => { events: readonly AuditEvent[]; nextCursor: number | null } }
export type CapabilityDecision = "allow" | "deny" | { kind: "approval_required"; approvalId: string }
export type CapabilityGate = { check(capability: P3Capability, resource: string, actor: string): Promise<CapabilityDecision>; getApproval?: (id: string) => { resource: string } | undefined; listApprovals?: (resource: string) => readonly ApprovalRequestRecord[]; resolve?: (id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) => unknown; cancel?: (id: string) => unknown }
type ServerDependencies = { auth: PrincipalAuthenticator; rateLimiter?: RateLimiter; workspace: WorkspacePort; runtime: RuntimeAdapter; audit: AuditPort; capability: CapabilityGate; instanceId?: string; tokenIssuer?: ScopedTokenAuthority; artifacts?: ArtifactStore; browser?: BrowserAutomationBroker; desktop?: DesktopAutomationBroker; workflow?: WorkflowRuntime; memory?: MemoryRuntime; capabilities?: CapabilityRegistry; ui?: McpUiControlBroker; uiAllowedActions?: ReadonlySet<string>; skillHub?: SkillRegistry }

/** Requests per principal per window when the caller injects no limiter. */
const DEFAULT_RATE_BUDGET = 240
const DEFAULT_RATE_WINDOW_MS = 60_000
type JsonRecord = Record<string, unknown>

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT")
}

function parseManifestResult(content: string | Uint8Array): WorkspaceManifest {
  const raw = typeof content === "string" ? content : new TextDecoder().decode(content)
  return migrateWorkspaceManifest(JSON.parse(raw))
}

/**
 * Serialise one runtime event as a wire-format SSE frame.
 * WHY: the `id:` line is omitted when no sequence exists — emitting an empty
 * `id:` would reset the client's Last-Event-ID and break cursor resumption.
 */
export function sseFrame(event: { sequence?: number }): string {
  const id = typeof event.sequence === "number" ? `id: ${event.sequence}\n` : ""
  return `${id}data: ${JSON.stringify(event)}\n\n`
}

/**
 * Encodes a file read result for the wire.
 *
 * WHY: FileReadResult.content is `string | Uint8Array`, and JSON.stringify turns
 * a Uint8Array into `{"type":"Buffer","data":[104,101,...]}` — a Node-specific
 * blob that no client can rely on and that inflates a text file about sixfold.
 * The encoding is now stated explicitly so the caller can decode deterministically.
 */
export function encodeReadResult(result: FileReadResult): JsonRecord {
  const { content, ...rest } = result
  return typeof content === "string"
    ? { ...rest, content, encoding: "utf-8" }
    : { ...rest, content: Buffer.from(content).toString("base64"), encoding: "base64" }
}

async function body(request: Request): Promise<JsonRecord> {
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body must be an object")
    return value as JsonRecord
  } catch { throw new Error("invalid JSON body") }
}

export class WorkbenchServer {
  readonly #workspace: WorkspacePort
  readonly #runtime: RuntimeAdapter
  readonly #audit: AuditPort
  readonly #capability: CapabilityGate
  readonly #artifacts?: ArtifactStore
  readonly #browser?: BrowserAutomationBroker
  readonly #desktop?: DesktopAutomationBroker
  readonly #workflow?: WorkflowRuntime
  readonly #memory?: MemoryRuntime
  readonly #capabilities?: CapabilityRegistry
  readonly #ui?: McpUiControlBroker
  readonly #uiAllowedActions?: ReadonlySet<string>
  readonly #workflowOwners = new Map<string, string>()
  readonly #workflowOwnerLimit = 1_000
  readonly #tokens = new Map<string, WorkspaceHandle>()
  readonly #runtimeTokens = new Map<string, string>()
  readonly #nativeTokens = new Map<string, Set<string>>()
  readonly #sessionOwners = new Map<string, string>()
  readonly #skillHub?: SkillRegistry
  readonly #auth: PrincipalAuthenticator
  readonly #rateLimiter: RateLimiter
  readonly #instanceId: string
  readonly #tokenIssuer?: ScopedTokenAuthority
  readonly #operations = new OperationRegistry(() => `operation-${randomUUID()}`)

  constructor(dependencies: ServerDependencies) {
    this.#auth = dependencies.auth
    this.#instanceId = dependencies.instanceId ?? randomUUID()
    this.#tokenIssuer = dependencies.tokenIssuer
    // WHY: a limiter is always installed. An absent `rateLimiter` must mean
    // "use the default budget", never "no limit" — omission must not disable a
    // control.
    this.#rateLimiter = dependencies.rateLimiter ?? new FixedWindowRateLimiter(DEFAULT_RATE_BUDGET, DEFAULT_RATE_WINDOW_MS)
    this.#workspace = dependencies.workspace
    this.#runtime = dependencies.runtime
    this.#audit = dependencies.audit
    this.#capability = dependencies.capability
    this.#artifacts = dependencies.artifacts
    this.#browser = dependencies.browser
    this.#desktop = dependencies.desktop
    this.#workflow = dependencies.workflow
    this.#memory = dependencies.memory
    this.#capabilities = dependencies.capabilities
    this.#ui = dependencies.ui
    this.#uiAllowedActions = dependencies.uiAllowedActions
    this.#skillHub = dependencies.skillHub
  }

  /**
   * WHY the router is awaited in a separate method: this method used to inline
   * the if-chain and `return this.#handler(...)` without awaiting. In an async
   * function a returned promise settles *outside* the try block, so the catch
   * below never saw a handler rejection — the error path was dead for every
   * route, and a failing handler escaped as an unhandled rejection instead of
   * an audited 400. In-memory tests never rejected, so nothing revealed it.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const origin = checkRequestOrigin(request.headers.get("origin"))
      if (!origin.allowed) return addSecurityHeaders(json(403, { error: "origin not allowed" }))
      if (request.method === "OPTIONS") return addSecurityHeaders(new Response(null, { status: 204 }), origin.origin)
      return addSecurityHeaders(await this.#route(request), origin.origin)
    } catch (error) {
      this.#audit.record("workbench-server", "request.error", "deny")
      return json(400, { error: error instanceof Error ? error.message : "request failed" })
    }
  }

  /**
   * Native bridge boundary for short-lived scoped credentials.
   * WHY this is a method instead of an HTTP route: the signing key and issuer
   * must remain inside the native/server process and never become WebView data.
   */
  async issueNativeScopedToken(request: Omit<ScopedTokenRequest, "instanceId">): Promise<ScopedToken> {
    if (!this.#tokenIssuer) throw new Error("scoped token issuer is not configured")
    const token = this.#tokenIssuer.issue({ ...request, instanceId: this.#instanceId })
    await this.#registerNativeToken(token)
    this.#allow("token.issue")
    return token
  }

  async rotateNativeScopedToken(request: Omit<ScopedTokenRequest, "instanceId">): Promise<{ token: ScopedToken; previousToken: string | null; gracePeriodMs: number }> {
    if (!this.#tokenIssuer) throw new Error("scoped token issuer is not configured")
    const rotation = this.#tokenIssuer.rotate({ ...request, instanceId: this.#instanceId })
    await this.#registerNativeToken(rotation.token)
    if (rotation.previousToken) await this.#registerNativeToken({ ...rotation.token, token: rotation.previousToken })
    this.#allow("token.rotate")
    return rotation
  }

  async revokeNativeScopedToken(workspaceId: string): Promise<void> {
    if (!this.#tokenIssuer) throw new Error("scoped token issuer is not configured")
    this.#tokenIssuer.revoke({ workspaceId, instanceId: this.#instanceId })
    for (const token of this.#nativeTokens.get(workspaceId) ?? []) {
      await this.#workspace.close(this.#runtimeTokens.get(token) ?? token).catch(() => undefined)
      this.#runtimeTokens.delete(token)
      this.#tokens.delete(token)
    }
    this.#nativeTokens.delete(workspaceId)
    this.#allow("token.revoke")
  }

  async #route(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const segments = url.pathname.split("/").filter(Boolean)
      if (segments[0] !== "v1") return this.#deny("route.unknown", 404)
      const principal = await this.#authenticate(request)
      if (!principal) return this.#deny("auth.principal", 401)
      if (!this.#rateLimiter.take(principal.id)) return this.#deny("auth.rate-limit", 429)
      if (request.method === "POST" && segments[1] === "handshake") return this.#handshake(request)
      if (request.method === "POST" && segments[1] === "workspaces" && segments[2] === "register") return this.#register(request, principal)
      if (segments[1] === "workspaces" && segments[3] === "open" && request.method === "POST") return this.#open(segments[2], principal)
      if (segments[1] === "workspaces" && segments[3] === "sessions") return this.#sessions(request, segments[2])
      if (segments[1] === "sessions" && segments[3] === "prompt" && request.method === "POST") return this.#prompt(request, segments[2])
      if (segments[1] === "sessions" && segments[3] === "events" && request.method === "GET") return this.#events(request, segments[2])
      if (segments[1] === "operations" && segments[3] === "cancel" && request.method === "POST") return this.#cancelOperation(request, segments[2])
      if (segments[1] === "files" && (segments[2] === "read" || segments[2] === "write") && request.method === "POST") return this.#files(request, segments[2])
      if (segments[1] === "files" && (segments[2] === "list" || segments[2] === "search") && request.method === "GET") return this.#fileIndex(request, segments[2])
      if (segments[1] === "design-systems" && request.method === "GET") return this.#designSystems(request)
      if (segments[1] === "file-sessions" && request.method === "DELETE") return this.#closeFileSession(request, segments[2])
      if (segments[1] === "approvals" && request.method === "GET") return this.#approvalList(request)
      if (segments[1] === "approvals" && (request.method === "POST" || request.method === "DELETE")) return this.#approval(request, segments[2])
      if (segments[1] === "trace" && request.method === "GET") return this.#auditPage(request, "trace")
      if (segments[1] === "activity" && request.method === "GET") return this.#auditPage(request, "activity")
      if (segments[1] === "artifacts" && request.method === "GET") return this.#artifactRead(request, segments[2])
      if (segments[1] === "artifacts" && segments[2] === "export" && request.method === "POST") return this.#artifactExport(request)
      if (segments[1] === "artifacts" && request.method === "POST") return this.#artifactWrite(request)
      if (segments[1] === "documents" && request.method === "GET") return this.#documents(request)
      if (segments[1] === "specs" && segments[2] === "validate" && request.method === "POST") return this.#specValidate(request)
      if (segments[1] === "browser" && request.method === "POST") return this.#browserAction(request, segments[2])
      if (segments[1] === "desktop" && request.method === "POST") return this.#desktopAction(request, segments[2])
      if (segments[1] === "workflows" && request.method === "POST") return this.#workflowAction(request, segments[2])
      if (segments[1] === "memory" && (request.method === "GET" || request.method === "POST" || request.method === "DELETE")) return this.#memoryAction(request, segments[2])
      if (segments[1] === "capabilities" && (request.method === "GET" || request.method === "POST")) return this.#capabilityAction(request, segments[2])
      if (segments[1] === "ui" && segments[2] === "actions" && request.method === "POST") return this.#uiAction(request)
      if (segments[1] === "ui" && segments[2] === "render" && request.method === "POST") return this.#renderUi(request)
      if (segments[1] === "skill-hub" && (segments[2] === "search" || segments[2] === "install" || segments[2] === "update") && ((request.method === "GET" && segments[2] === "search") || request.method === "POST")) return this.#skillHubAction(request, segments[2])
      return this.#deny("route.unknown", 404)
  }

  async #authenticate(request: Request): Promise<Principal | undefined> {
    const principal = await this.#auth.authenticate(request)
    if (principal) return principal
    const bearer = this.#bearer(request)
    if (!bearer || !this.#tokenIssuer) return undefined
    const token = this.#tokenIssuer.verify(bearer)
    if (!token) return undefined
    return {
      id: token.principalId,
      scopes: new Set(["workspace.open", ...token.capabilities]),
      workspaces: new Set([token.workspaceId]),
    }
  }

  async #registerNativeToken(token: ScopedToken): Promise<void> {
    const runtimeHandle = await this.#workspace.open(token.workspaceId)
    this.#tokens.set(token.token, { id: token.workspaceId, token: token.token })
    this.#runtimeTokens.set(token.token, runtimeHandle.token)
    const tokens = this.#nativeTokens.get(token.workspaceId) ?? new Set<string>()
    tokens.add(token.token)
    this.#nativeTokens.set(token.workspaceId, tokens)
  }

  async #handshake(request: Request): Promise<Response> {
    const input = parseHandshakeRequest(await body(request))
    const supported = input.protocolVersion === WIRE_PROTOCOL_VERSION && input.supportedVersions.includes(WIRE_PROTOCOL_VERSION)
    if (!supported) {
      this.#audit.record("workbench-server", "handshake.unsupported-version", "deny")
      return json(200, {
        kind: "workbench.handshake.refused",
        accepted: false,
        protocolVersion: null,
        supportedVersions: [WIRE_PROTOCOL_VERSION],
        instanceId: this.#instanceId,
        reason: "unsupported-version",
      })
    }
    this.#audit.record("workbench-server", "handshake.accept", "allow")
    return json(200, {
      kind: "workbench.handshake.accepted",
      accepted: true,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      supportedVersions: [WIRE_PROTOCOL_VERSION],
      instanceId: this.#instanceId,
    })
  }

  async #register(request: Request, principal: Principal): Promise<Response> {
    if (!principalCanRegister(principal)) return this.#deny("workspace.register.scope", 403)
    const input = await body(request)
    if (typeof input.name !== "string" || typeof input.path !== "string") return this.#deny("workspace.register", 400)
    const workspace = await this.#workspace.register({ name: input.name, path: input.path })
    this.#allow("workspace.register")
    return json(201, workspace as unknown as JsonRecord)
  }

  async #open(workspaceId: string, principal: Principal): Promise<Response> {
    if (!principalCanOpen(principal, workspaceId)) return this.#deny("workspace.open.scope", 403)
    const handle = await this.#workspace.open(workspaceId)
    this.#tokens.set(handle.token, handle)
    this.#allow("workspace.open")
    return json(200, handle as unknown as JsonRecord)
  }

  async #sessions(request: Request, workspaceId: string): Promise<Response> {
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("session.scope", 403)
    if (request.method === "GET") {
      const sessions = await this.#runtime.listSessions({ workspaceId })
      for (const session of sessions) this.#sessionOwners.set(session.id, workspaceId)
      this.#allow("session.list")
      return json(200, { sessions })
    }
    if (request.method === "POST") {
      const session = await this.#runtime.createSession({ workspaceId })
      this.#sessionOwners.set(session.id, workspaceId)
      this.#allow("session.create")
      return json(201, { session })
    }
    return this.#deny("session.method", 405)
  }

  async #events(request: Request, sessionId: string): Promise<Response> {
    const workspaceId = this.#sessionOwners.get(sessionId)
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("session.events.scope", 403)
    const eventGate = await this.#checkCapability("workspace.watch", workspaceId)
    if (eventGate) return eventGate
    const requestedCursor = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? "0")
    const afterSequence = Number.isSafeInteger(requestedCursor) && requestedCursor > 0 ? requestedCursor : 0
    const iterator = this.#runtime.subscribeEvents({ sessionId, afterSequence })[Symbol.asyncIterator]()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // WHY an immediate comment frame: without any byte on the wire the
        // client can stall waiting for headers to flush, and an idle connection
        // is a candidate for proxy and server idle timeouts before the first
        // real event ever arrives. A comment line is ignored by SSE parsers.
        controller.enqueue(encoder.encode(": unifia stream open\n\n"))
      },
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) controller.close()
          else controller.enqueue(encoder.encode(sseFrame(next.value)))
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel() { await iterator.return?.() },
    })
    this.#allow("session.events")
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" } })
  }
  async #prompt(request: Request, sessionId: string): Promise<Response> {
    const workspaceId = this.#sessionOwners.get(sessionId)
    const token = workspaceId ? this.#authorize(request, workspaceId) : undefined
    if (!token || !workspaceId) return this.#deny("session.prompt.scope", 403)
    const input = await body(request)
    if (typeof input.prompt !== "string") return this.#deny("session.prompt", 400)
    const operation = this.#operations.start(workspaceId, sessionId, typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined)
    if (operation.state === "completed") return json(202, { accepted: true, workspaceId, operationId: operation.id })
    void this.#runPrompt(operation.id, sessionId, input.prompt)
    this.#allow("session.prompt")
    return json(202, { accepted: true, workspaceId, operationId: operation.id })
  }

  async #runPrompt(operationId: string, sessionId: string, prompt: string): Promise<void> {
    try {
      await this.#runtime.sendPrompt({ sessionId, prompt })
      this.#operations.complete(operationId)
    } catch (error) {
      this.#operations.fail(operationId, error)
    }
  }

  async #cancelOperation(request: Request, operationId: string): Promise<Response> {
    const operation = this.#operations.get(operationId)
    if (!operation || !this.#authorize(request, operation.workspaceId)) return this.#deny("operation.cancel.scope", 403)
    const gate = await this.#checkCapability("workspace.watch", operation.workspaceId)
    if (gate) return gate
    const cancelled = this.#operations.cancel(operationId)
    if (!cancelled) return this.#deny("operation.cancel", 409)
    await this.#runtime.cancelSession(operation.sessionId)
    this.#allow("operation.cancel")
    return json(200, { operation: cancelled })
  }

  async #files(request: Request, operation: "read" | "write"): Promise<Response> {
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || !Array.isArray(input.paths) && operation === "read") return this.#deny(`workspace.${operation}`, 400)
    const workspaceId = input.workspaceId
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny(`workspace.${operation}.scope`, 403)
    const capability = `workspace.${operation}` as P3Capability
    const capabilityResponse = await this.#checkCapability(capability, workspaceId)
    if (capabilityResponse) return capabilityResponse
    if (operation === "read") {
      const results = await this.#workspace.read(this.#runtimeToken(token), input.paths as string[])
      this.#allow("workspace.read")
      return json(200, { results: results.map(encodeReadResult) })
    }
    if (!Array.isArray(input.writes)) return this.#deny("workspace.write", 400)
    const results = await this.#workspace.write(this.#runtimeToken(token), input.writes as FileWrite[])
    this.#allow("workspace.write")
    return json(200, { results: results as unknown as JsonRecord[] })
  }

  async #fileIndex(request: Request, operation: "list" | "search"): Promise<Response> {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny(`workspace.${operation}`, 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny(`workspace.${operation}.scope`, 403)
    const capabilityResponse = await this.#checkCapability("workspace.read", workspaceId)
    if (capabilityResponse) return capabilityResponse
    const prefix = url.searchParams.get("prefix") ?? "."
    const entries = operation === "list"
      ? await this.#workspace.list(this.#runtimeToken(token), prefix)
      : await this.#workspace.search(this.#runtimeToken(token), url.searchParams.get("query") ?? "", prefix)
    this.#allow("workspace.read")
    return json(200, { entries })
  }

  async #designSystems(request: Request): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("design-system.manifest", 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("design-system.manifest.scope", 403)
    const capabilityResponse = await this.#checkCapability("workspace.read", workspaceId)
    if (capabilityResponse) return capabilityResponse
    let result: FileReadResult | undefined
    try {
      result = (await this.#workspace.read(this.#runtimeToken(token), [WORKSPACE_MANIFEST_PATH]))[0]
    } catch (error) {
      if (isMissingFile(error)) return this.#deny("design-system.manifest.missing", 404)
      throw error
    }
    if (!result) return this.#deny("design-system.manifest.missing", 404)
    try {
      const manifest = parseManifestResult(result.content)
      this.#allow("workspace.read")
      return json(200, manifest as unknown as JsonRecord)
    } catch {
      return this.#deny("design-system.manifest.invalid", 400)
    }
  }

  async #browserAction(request: Request, action: string): Promise<Response> {
    if (!this.#browser) return this.#deny("browser.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("browser.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("browser.scope", 403)
    const gate = await this.#checkCapability("browser.navigate", input.workspaceId)
    if (gate) return gate
    if (action === "navigate" && typeof input.url === "string") { await this.#browser.navigate(input.workspaceId, input.url); this.#allow("browser.navigate"); return json(202, { accepted: true }) }
    if (action === "snapshot") { const snapshot = await this.#browser.snapshot(input.workspaceId); this.#allow("browser.snapshot"); return json(200, { snapshot }) }
    if (action === "screenshot") { const screenshot = await this.#browser.screenshot(input.workspaceId); this.#allow("browser.screenshot"); return json(200, { contentType: "image/png", data: Buffer.from(screenshot).toString("base64") }) }
    return this.#deny("browser.action", 400)
  }

  async #desktopAction(request: Request, action: string): Promise<Response> {
    if (!this.#desktop) return this.#deny("desktop.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || typeof input.appId !== "string") return this.#deny("desktop.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("desktop.scope", 403)
    const target = { appId: input.appId, windowId: typeof input.windowId === "string" ? input.windowId : undefined }
    if (action === "observe") { const gate = await this.#checkCapability("desktop.observe", input.workspaceId); if (gate) return gate; const observation = await this.#desktop.observe(target); this.#allow("desktop.observe"); return json(200, { observation }) }
    if (action === "control" && (input.action === "keyboard" || input.action === "mouse")) { const gate = await this.#checkCapability("desktop.control", input.workspaceId); if (gate) return gate; await this.#desktop.control(target, input.action, input.payload); this.#allow("desktop.control"); return json(202, { accepted: true }) }
    return this.#deny("desktop.action", 400)
  }

  async #workflowAction(request: Request, action: string): Promise<Response> {
    if (!this.#workflow) return this.#deny("workflow.unavailable", 503)
    const input = await body(request)
    if (action === "start") {
      if (typeof input.workspaceId !== "string" || !input.definition || typeof input.definition !== "object") return this.#deny("workflow.start", 400)
      const token = this.#authorize(request, input.workspaceId)
      if (!token) return this.#deny("workflow.scope", 403)
      const gate = await this.#checkCapability("workflow.run", input.workspaceId)
      if (gate) return gate
      const definition = { ...(input.definition as WorkflowDefinition), workspaceId: input.workspaceId }
      const state = await this.#workflow.start(definition)
      this.#workflowOwners.set(state.workflowId, input.workspaceId)
      while (this.#workflowOwners.size > this.#workflowOwnerLimit) {
        const oldest = this.#workflowOwners.keys().next().value
        if (typeof oldest !== "string") break
        this.#workflowOwners.delete(oldest)
      }
      this.#allow("workflow.start")
      return json(202, { state })
    }
    if (typeof input.workflowId !== "string") return this.#deny("workflow.scope", 400)
    const workspaceId = this.#workflowOwners.get(input.workflowId)
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("workflow.scope", 403)
    const state = action === "resume" ? await this.#workflow.resume(input.workflowId) : action === "cancel" ? await this.#workflow.cancel(input.workflowId) : undefined
    if (!state) return this.#deny("workflow.action", 400)
    if (action === "cancel" || state.status === "completed" || state.status === "failed" || state.status === "cancelled") this.#workflowOwners.delete(input.workflowId)
    this.#allow(`workflow.${action}`)
    return json(200, { state })
  }

  async #memoryAction(request: Request, action: string): Promise<Response> {
    if (!this.#memory) return this.#deny("memory.unavailable", 503)
    const input = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("memory.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("memory.scope", 403)
    if (request.method === "POST" && action === "remember") { const gate = await this.#checkCapability("workspace.write", input.workspaceId); if (gate) return gate; if (typeof input.content !== "string" || (input.source !== "user" && input.source !== "agent" && input.source !== "import")) return this.#deny("memory.remember", 400); const record = await this.#memory.remember({ workspaceId: input.workspaceId, content: input.content, source: input.source, tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : undefined, id: typeof input.id === "string" ? input.id : undefined }); this.#allow("memory.remember"); return json(201, { record }) }
    if (request.method === "GET" && action === "search") { const gate = await this.#checkCapability("workspace.read", input.workspaceId); if (gate) return gate; const records = await this.#memory.search({ workspaceId: input.workspaceId, text: typeof input.text === "string" ? input.text : undefined }); this.#allow("memory.search"); return json(200, { records }) }
    if (request.method === "DELETE" && action === "remove" && typeof input.id === "string") { const gate = await this.#checkCapability("workspace.write", input.workspaceId); if (gate) return gate; const removed = await this.#memory.remove(input.workspaceId, input.id); this.#allow("memory.remove"); return json(200, { removed }) }
    return this.#deny("memory.action", 400)
  }

  async #capabilityAction(request: Request, action: string): Promise<Response> {
    if (!this.#capabilities) return this.#deny("capability.unavailable", 503)
    const input = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("capability.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("capability.scope", 403)
    const gate = await this.#checkCapability("package.install", input.workspaceId)
    if (gate) return gate
    if (action === "register" && input.manifest && typeof input.manifest === "object") { this.#capabilities.register(input.manifest as CapabilityManifest); this.#allow("capability.register"); return json(201, { registered: true }) }
    if (action === "approve" && typeof input.digest === "string") { this.#capabilities.approve(input.digest); this.#allow("capability.approve"); return json(200, { approved: true }) }
    if (action === "enable" && typeof input.digest === "string") { this.#capabilities.enable(input.digest); this.#allow("capability.enable"); return json(200, { enabled: true }) }
    if (action === "revoke" && typeof input.digest === "string") { this.#capabilities.revoke(input.digest); this.#allow("capability.revoke"); return json(200, { revoked: true }) }
    if (action === "search") { const records = this.#capabilities.search({ tag: typeof input.tag === "string" ? input.tag : undefined, trustLevel: typeof input.trustLevel === "string" ? input.trustLevel as "untrusted" | "verified" | "official" : undefined, enabledOnly: input.enabledOnly === "true" }); this.#allow("capability.search"); return json(200, { records }) }
    return this.#deny("capability.action", 400)
  }

  async #uiAction(request: Request): Promise<Response> {
    if (!this.#ui) return this.#deny("ui.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || !input.action || typeof input.action !== "object") return this.#deny("ui.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("ui.scope", 403)
    const gate = await this.#checkCapability("desktop.control", input.workspaceId)
    if (gate) return gate
    const result = await this.#ui.execute(input.action as UiAction)
    this.#allow("ui.action")
    return json(result.status === "denied" ? 403 : result.status === "pending-approval" ? 202 : 200, { result })
  }

  async #renderUi(request: Request): Promise<Response> {
    if (!this.#uiAllowedActions) return this.#deny("ui.render.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || !input.node || typeof input.node !== "object" || Array.isArray(input.node)) return this.#deny("ui.render", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("ui.render.scope", 403)
    try {
      const rendered = renderGenerativeUi(input.node as UiNode, this.#uiAllowedActions)
      this.#allow("ui.render")
      return json(200, { rendered })
    } catch {
      return this.#deny("ui.render", 400)
    }
  }

  async #skillHubAction(request: Request, action: string): Promise<Response> {
    if (!this.#skillHub) return this.#deny("skill-hub.unavailable", 503)
    const input = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("skill-hub.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("skill-hub.scope", 403)
    if (action === "search") {
      const query = typeof input.query === "string" ? input.query : undefined
      const tags = typeof input.tags === "string" && input.tags.length > 0 ? input.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0) : Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : undefined
      const trust = input.trust === "untrusted" || input.trust === "verified" || input.trust === "official" ? input.trust : undefined
      const manifests = await this.#skillHub.search({ query, tags, trust })
      this.#allow("skill-hub.search")
      return json(200, { manifests })
    }
    if (action === "install") {
      if (typeof input.digest !== "string") return this.#deny("skill-hub.install", 400)
      const installed = await this.#skillHub.install(input.digest)
      this.#allow("skill-hub.install")
      return json(201, { installed })
    }
    if (action === "update") {
      if (typeof input.name !== "string") return this.#deny("skill-hub.update", 400)
      const updated = await this.#skillHub.update(input.name)
      this.#allow("skill-hub.update")
      return json(200, { updated: updated ?? null })
    }
    return this.#deny("skill-hub.action", 400)
  }

  async #approval(request: Request, id: string): Promise<Response> {
    const token = this.#bearer(request)
    const approval = token ? this.#capability.getApproval?.(id) : undefined
    if (!token || !approval || this.#tokens.get(token)?.id !== approval.resource) return this.#deny("approval.scope", 403)
    if (request.method === "DELETE") {
      const decision = this.#capability.cancel?.(id)
      if (!decision) return this.#deny("approval.cancel", 404)
      this.#audit.record("workbench-server", "approval.cancel", "deny")
      return json(200, { decision })
    }
    const input = await body(request)
    if (input.decision !== "allow" && input.decision !== "deny") return this.#deny("approval.resolve", 400)
    const decision = this.#capability.resolve?.(id, input.decision, "file-session", approval.resource)
    if (!decision) return this.#deny("approval.resolve", 404)
    this.#audit.record("workbench-server", "approval.resolve", (decision as { kind?: string }).kind === "allow" ? "allow" : "deny")
    return json(200, { decision })
  }
  async #approvalList(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    const token = workspaceId ? this.#authorize(request, workspaceId) : undefined
    if (!workspaceId || !token) return this.#deny("approval.list.scope", 403)
    const approvals = this.#capability.listApprovals?.(workspaceId)
    if (!approvals) return this.#deny("approval.list.unavailable", 503)
    this.#allow("approval.list")
    return json(200, { approvals })
  }
  async #auditPage(request: Request, kind: "trace" | "activity"): Promise<Response> {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny(`${kind}.scope`, 403)
    const after = Number(url.searchParams.get("after") ?? "0")
    const requestedLimit = Number(url.searchParams.get("limit") ?? "50")
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
    const page = this.#audit.page?.(Number.isSafeInteger(after) && after > 0 ? after : 0, limit)
    if (!page) return this.#deny(`${kind}.unavailable`, 503)
    this.#allow(`${kind}.read`)
    return json(200, { kind, ...page })
  }
  async #artifactRead(request: Request, artifactId?: string): Promise<Response> {
    if (!this.#artifacts) return this.#deny("artifact.read.unavailable", 503)
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("artifact.read.scope", 403)
    const gate = await this.#checkCapability("workspace.read", workspaceId)
    if (gate) return gate
    if (!artifactId) { this.#allow("artifact.list"); return json(200, { artifacts: await this.#artifacts.list() }) }
    const artifact = await this.#artifacts.latest(artifactId)
    if (!artifact) return this.#deny("artifact.not-found", 404)
    const content = await this.#artifacts.read(artifact)
    this.#allow("artifact.read")
    return json(200, { artifact, content: Buffer.from(content).toString("base64"), encoding: "base64" })
  }
  async #artifactWrite(request: Request): Promise<Response> {
    if (!this.#artifacts) return this.#deny("artifact.create.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || typeof input.kind !== "string" || typeof input.filename !== "string" || typeof input.content !== "string") return this.#deny("artifact.create", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("artifact.create.scope", 403)
    const gate = await this.#checkCapability("artifact.create", input.workspaceId)
    if (gate) return gate
    const artifact = await this.#artifacts.create({ kind: input.kind as Parameters<ArtifactStore["create"]>[0]["kind"], filename: input.filename, content: input.content, artifactId: typeof input.artifactId === "string" ? input.artifactId : undefined, metadata: input.metadata as Record<string, string> | undefined, provenance: input.provenance as Parameters<ArtifactStore["create"]>[0]["provenance"] })
    this.#allow("artifact.create")
    return json(201, { artifact })
  }
  async #artifactExport(request: Request): Promise<Response> {
    if (!this.#artifacts) return this.#deny("artifact.export.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || typeof input.artifactId !== "string") return this.#deny("artifact.export", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("artifact.export.scope", 403)
    const gate = await this.#checkCapability("artifact.export", input.workspaceId)
    if (gate) return gate
    const artifact = await this.#artifacts.latest(input.artifactId)
    if (!artifact) return this.#deny("artifact.export.not-found", 404)
    const exported = await this.#artifacts.export(artifact, { outbox: typeof input.outbox === "string" ? input.outbox : undefined, metadata: input.metadata === "keep" ? "keep" : "strip" })
    this.#allow("artifact.export")
    return json(200, { exported })
  }
  async #documents(request: Request): Promise<Response> {
    if (!this.#artifacts) return this.#deny("documents.unavailable", 503)
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("documents.scope", 403)
    const gate = await this.#checkCapability("workspace.read", workspaceId)
    if (gate) return gate
    const documents = (await this.#artifacts.list()).filter((artifact) => artifact.kind !== "binary")
    this.#allow("documents.list")
    return json(200, { documents })
  }
  async #specValidate(request: Request): Promise<Response> {
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || (typeof input.spec !== "string" && (!input.spec || typeof input.spec !== "object"))) return this.#deny("spec.validate", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("spec.validate.scope", 403)
    const gate = await this.#checkCapability("workspace.read", input.workspaceId)
    if (gate) return gate
    const spec = parseSpec(input.spec)
    const resolution = resolveEffectiveCapabilities(spec, [])
    this.#allow("spec.validate")
    return json(200, { valid: true, spec, capabilities: resolution })
  }
  async #closeFileSession(request: Request, token: string): Promise<Response> {
    const supplied = this.#bearer(request)
    if (!supplied || supplied !== token || !this.#tokens.has(token)) return this.#deny("workspace.close.scope", 403)
    await this.#workspace.close(this.#runtimeToken(token))
    this.#runtimeTokens.delete(token)
    this.#tokens.delete(token)
    this.#allow("workspace.close")
    return json(200, { closed: true })
  }

  /**
   * Closes every open file session.
   *
   * WHY it swallows per-token failures: shutdown must release as many sessions
   * as it can. One workspace whose root already vanished must not leave the
   * others holding watchers. The failures are returned so a caller can report
   * them rather than discover them silently.
   */
  async shutdown(): Promise<readonly string[]> {
    const failures: string[] = []
    for (const token of [...this.#tokens.keys()]) {
      try {
        await this.#workspace.close(this.#runtimeToken(token))
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "close failed")
      }
      this.#tokens.delete(token)
      this.#runtimeTokens.delete(token)
    }
    this.#audit.record("workbench-server", "workspace.shutdown", failures.length === 0 ? "allow" : "deny")
    return failures
  }

  /** Number of file sessions currently open. Exposed for shutdown assertions. */
  get openFileSessions(): number {
    return this.#tokens.size
  }

  #runtimeToken(token: string): string {
    return this.#runtimeTokens.get(token) ?? token
  }

  get instanceId(): string {
    return this.#instanceId
  }

  #authorize(request: Request, workspaceId: string): string | undefined {
    const token = this.#bearer(request)
    const handle = token ? this.#tokens.get(token) : undefined
    return handle?.id === workspaceId ? token : undefined
  }

  /**
   * Reads the file-session token, which is a capability handle and NOT the
   * caller's identity — identity lives in `Authorization` and is resolved by
   * the PrincipalAuthenticator.
   *
   * WHY the Authorization fallback: callers that predate principal
   * authentication carry the file-session token in `Authorization: Bearer`.
   * The fallback is safe because the value is only ever looked up in #tokens —
   * a principal token is never present there, so a misrouted credential fails
   * closed with 403 rather than granting access.
   */
  #bearer(request: Request): string | undefined {
    const scoped = request.headers.get("x-unifia-file-session")
    if (scoped) return scoped
    const value = request.headers.get("authorization")
    return value?.startsWith("Bearer ") ? value.slice(7) : undefined
  }

  async #checkCapability(capability: P3Capability, resource: string): Promise<Response | undefined> {
    const decision = await this.#capability.check(capability, resource, "workbench-server")
    if (decision === "allow") return undefined
    if (typeof decision === "object") {
      this.#audit.record("workbench-server", capability, "approval_required")
      return json(202, { approvalRequired: true, approvalId: decision.approvalId, capability })
    }
    return this.#deny(capability, 403)
  }

  #allow(capability: string): void { this.#audit.record("workbench-server", capability, "allow") }
  #deny(capability: string, status: number): Response { this.#audit.record("workbench-server", capability, "deny"); return json(status, { error: "denied", capability }) }
}

export class ApprovalCapabilityGate implements CapabilityGate {
  readonly #broker: ApprovalBroker
  readonly #allowlisted: ReadonlySet<P3Capability>
  readonly #ttlMs: number
  constructor(broker: ApprovalBroker, allowlisted: ReadonlySet<P3Capability> = new Set(), ttlMs = 30_000) {
    this.#broker = broker
    this.#allowlisted = allowlisted
    this.#ttlMs = ttlMs
  }
  async check(capability: P3Capability, resource: string, _actor: string): Promise<CapabilityDecision> {
    if (this.#allowlisted.has(capability)) return "allow"
    const existing = this.#broker.find(capability, resource)
    if (existing?.status === "allow") return "allow"
    if (existing?.status === "pending") return { kind: "approval_required", approvalId: existing.id }
    const request = this.#broker.request(capability, resource, Date.now() + this.#ttlMs)
    return { kind: "approval_required", approvalId: request.id }
  }
  getApproval(id: string) { return this.#broker.get(id) }
  listApprovals(resource: string) { return this.#broker.pending(resource) }
  resolve(id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) { return this.#broker.resolve(id, decision, actor, grantedResource) }
  cancel(id: string) { return this.#broker.cancel(id) }
}
