import { ApprovalBroker, type BrowserAutomationBroker } from "@unifia/contracts"
/* SPDX-License-Identifier: MIT */
import type {
  FileReadResult,
  FileWrite,
  P3Capability,
  RuntimeAdapter,
  Workspace,
  WorkspaceHandle,
  WorkspacePort,
} from "@unifia/contracts"

type AuditPort = { record(actor: string, capability: string, decision: "allow" | "deny" | "approval_required"): unknown }
export type CapabilityDecision = "allow" | "deny" | { kind: "approval_required"; approvalId: string }
export type CapabilityGate = { check(capability: P3Capability, resource: string, actor: string): Promise<CapabilityDecision>; getApproval?: (id: string) => { resource: string } | undefined; resolve?: (id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) => unknown; cancel?: (id: string) => unknown }
type ServerDependencies = { workspace: WorkspacePort; runtime: RuntimeAdapter; audit: AuditPort; capability: CapabilityGate; browser?: BrowserAutomationBroker }
type JsonRecord = Record<string, unknown>

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
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
  readonly #browser?: BrowserAutomationBroker
  readonly #tokens = new Map<string, WorkspaceHandle>()
  readonly #sessionOwners = new Map<string, string>()

  constructor(dependencies: ServerDependencies) {
    this.#workspace = dependencies.workspace
    this.#runtime = dependencies.runtime
    this.#audit = dependencies.audit
    this.#capability = dependencies.capability
    this.#browser = dependencies.browser
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const segments = url.pathname.split("/").filter(Boolean)
      if (segments[0] !== "v1") return this.#deny("route.unknown", 404)
      if (request.method === "POST" && segments[1] === "workspaces" && segments[2] === "register") return this.#register(request)
      if (segments[1] === "workspaces" && segments[3] === "open" && request.method === "POST") return this.#open(segments[2])
      if (segments[1] === "workspaces" && segments[3] === "sessions") return this.#sessions(request, segments[2])
      if (segments[1] === "sessions" && segments[3] === "prompt" && request.method === "POST") return this.#prompt(request, segments[2])
      if (segments[1] === "sessions" && segments[3] === "events" && request.method === "GET") return this.#events(request, segments[2])
      if (segments[1] === "files" && (segments[2] === "read" || segments[2] === "write") && request.method === "POST") return this.#files(request, segments[2])
      if (segments[1] === "file-sessions" && request.method === "DELETE") return this.#closeFileSession(request, segments[2])
      if (segments[1] === "approvals" && (request.method === "POST" || request.method === "DELETE")) return this.#approval(request, segments[2])
      if (segments[1] === "browser" && request.method === "POST") return this.#browserAction(request, segments[2])
      return this.#deny("route.unknown", 404)
    } catch (error) {
      this.#audit.record("workbench-server", "request.error", "deny")
      return json(400, { error: error instanceof Error ? error.message : "request failed" })
    }
  }

  async #register(request: Request): Promise<Response> {
    const input = await body(request)
    if (typeof input.name !== "string" || typeof input.path !== "string") return this.#deny("workspace.register", 400)
    const workspace = await this.#workspace.register({ name: input.name, path: input.path })
    this.#allow("workspace.register")
    return json(201, workspace as unknown as JsonRecord)
  }

  async #open(workspaceId: string): Promise<Response> {
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
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) controller.close()
          else controller.enqueue(encoder.encode(`id: ${next.value.sequence ?? ""}\\ndata: ${JSON.stringify(next.value)}\\n\\n`))
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
    await this.#runtime.sendPrompt({ sessionId, prompt: input.prompt })
    this.#allow("session.prompt")
    return json(202, { accepted: true, workspaceId })
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
      const results = await this.#workspace.read(token, input.paths as string[])
      this.#allow("workspace.read")
      return json(200, { results: results as unknown as JsonRecord[] })
    }
    if (!Array.isArray(input.writes)) return this.#deny("workspace.write", 400)
    const results = await this.#workspace.write(token, input.writes as FileWrite[])
    this.#allow("workspace.write")
    return json(200, { results: results as unknown as JsonRecord[] })
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
  async #closeFileSession(request: Request, token: string): Promise<Response> {
    const supplied = this.#bearer(request)
    if (!supplied || supplied !== token || !this.#tokens.has(token)) return this.#deny("workspace.close.scope", 403)
    await this.#workspace.close(token)
    this.#tokens.delete(token)
    this.#allow("workspace.close")
    return json(200, { closed: true })
  }

  #authorize(request: Request, workspaceId: string): string | undefined {
    const token = this.#bearer(request)
    const handle = token ? this.#tokens.get(token) : undefined
    return handle?.id === workspaceId ? token : undefined
  }

  #bearer(request: Request): string | undefined {
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
  resolve(id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) { return this.#broker.resolve(id, decision, actor, grantedResource) }
  cancel(id: string) { return this.#broker.cancel(id) }
}
