/* SPDX-License-Identifier: MIT */
import type {
  FileReadResult,
  FileWrite,
  RuntimeAdapter,
  Workspace,
  WorkspaceHandle,
  WorkspacePort,
} from "@unifia/contracts"

type AuditPort = { record(actor: string, capability: string, decision: "allow" | "deny" | "approval_required"): unknown }
type ServerDependencies = { workspace: WorkspacePort; runtime: RuntimeAdapter; audit: AuditPort }
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
  readonly #tokens = new Map<string, WorkspaceHandle>()
  readonly #sessionOwners = new Map<string, string>()

  constructor(dependencies: ServerDependencies) {
    this.#workspace = dependencies.workspace
    this.#runtime = dependencies.runtime
    this.#audit = dependencies.audit
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
      if (segments[1] === "files" && (segments[2] === "read" || segments[2] === "write") && request.method === "POST") return this.#files(request, segments[2])
      if (segments[1] === "file-sessions" && request.method === "DELETE") return this.#closeFileSession(request, segments[2])
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

  #allow(capability: string): void { this.#audit.record("workbench-server", capability, "allow") }
  #deny(capability: string, status: number): Response { this.#audit.record("workbench-server", capability, "deny"); return json(status, { error: "denied", capability }) }
}
