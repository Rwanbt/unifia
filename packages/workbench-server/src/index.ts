import { ApprovalBroker, CapabilityRegistry, type BrowserAutomationBroker, type McpUiControlBroker, type UiAction, type CapabilityManifest, type DesktopAutomationBroker } from "@unifia/contracts"
/* SPDX-License-Identifier: MIT */
import type { MemoryRuntime } from "@unifia/memory-runtime"
import type { WorkflowDefinition, WorkflowRuntime } from "@unifia/workflow-runtime"
import type { SkillRegistry } from "@unifia/skill-hub"
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
type ServerDependencies = { workspace: WorkspacePort; runtime: RuntimeAdapter; audit: AuditPort; capability: CapabilityGate; browser?: BrowserAutomationBroker; desktop?: DesktopAutomationBroker; workflow?: WorkflowRuntime; memory?: MemoryRuntime; capabilities?: CapabilityRegistry; ui?: McpUiControlBroker; skillHub?: SkillRegistry }
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
  readonly #desktop?: DesktopAutomationBroker
  readonly #workflow?: WorkflowRuntime
  readonly #memory?: MemoryRuntime
  readonly #capabilities?: CapabilityRegistry
  readonly #ui?: McpUiControlBroker
  readonly #workflowOwners = new Map<string, string>()
  readonly #tokens = new Map<string, WorkspaceHandle>()
  readonly #sessionOwners = new Map<string, string>()
  readonly #skillHub?: SkillRegistry

  constructor(dependencies: ServerDependencies) {
    this.#workspace = dependencies.workspace
    this.#runtime = dependencies.runtime
    this.#audit = dependencies.audit
    this.#capability = dependencies.capability
    this.#browser = dependencies.browser
    this.#desktop = dependencies.desktop
    this.#workflow = dependencies.workflow
    this.#memory = dependencies.memory
    this.#capabilities = dependencies.capabilities
    this.#ui = dependencies.ui
    this.#skillHub = dependencies.skillHub
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
      if (segments[1] === "desktop" && request.method === "POST") return this.#desktopAction(request, segments[2])
      if (segments[1] === "workflows" && request.method === "POST") return this.#workflowAction(request, segments[2])
      if (segments[1] === "memory" && (request.method === "GET" || request.method === "POST" || request.method === "DELETE")) return this.#memoryAction(request, segments[2])
      if (segments[1] === "capabilities" && (request.method === "GET" || request.method === "POST")) return this.#capabilityAction(request, segments[2])
      if (segments[1] === "ui" && segments[2] === "actions" && request.method === "POST") return this.#uiAction(request)
      if (segments[1] === "skill-hub" && (segments[2] === "search" || segments[2] === "install" || segments[2] === "update") && ((request.method === "GET" && segments[2] === "search") || request.method === "POST")) return this.#skillHubAction(request, segments[2])
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
      this.#allow("workflow.start")
      return json(202, { state })
    }
    if (typeof input.workflowId !== "string") return this.#deny("workflow.scope", 400)
    const workspaceId = this.#workflowOwners.get(input.workflowId)
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("workflow.scope", 403)
    const state = action === "resume" ? await this.#workflow.resume(input.workflowId) : action === "cancel" ? await this.#workflow.cancel(input.workflowId) : undefined
    if (!state) return this.#deny("workflow.action", 400)
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
