/* SPDX-License-Identifier: MIT */

import { createHash, timingSafeEqual } from "node:crypto"
import path from "node:path"
import { createWorkbenchApp, type WorkbenchApp } from "@unifia/workbench-server/bootstrap"
import type { WorkbenchPtyConnection, WorkbenchPtySocket } from "@unifia/workbench-server"
import { P3_CAPABILITIES, type P3Capability } from "@unifia/contracts"
import { Global } from "../global/path"
import { OpenCodeSessionBackend } from "../unifia/opencode-runtime-backend"
import { discoverTemplates } from "@unifia/skill-hub/node"
import { Pty } from "../pty"
import { PtyID } from "../pty/schema"
import * as GithubAuth from "../github/auth"

type NativeTokenInput = {
  action: "open" | "issue" | "rotate" | "revoke"
  workspacePath?: string
  workspaceId?: string
  capabilities?: P3Capability[]
}

const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set(P3_CAPABILITIES)

type WorkbenchBridge = {
  app: WorkbenchApp
  fetch(request: Request): Promise<Response>
  native(request: Request): Promise<Response>
  ptyConnect(request: Request, workspaceId: string, ptyId: string, socket: WorkbenchPtySocket, cursor?: number): Promise<WorkbenchPtyConnection | undefined>
}

const NATIVE_PRINCIPAL = "unifia-native-workbench"

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function sameSecret(expected: string, supplied: string | null): boolean {
  if (!supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readInput(value: unknown): NativeTokenInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("native Workbench input must be an object")
  const input = value as Record<string, unknown>
  const action = input.action
  if (action !== "open" && action !== "issue" && action !== "rotate" && action !== "revoke") throw new Error("unsupported native Workbench action")
  const capabilities = input.capabilities
  // SEC-001/C2-3: "array of strings" alone let any string through as a
  // capability name, including ones that don't exist at all — this checks
  // membership in the canonical P3_CAPABILITIES list too. It does not
  // enforce the narrower connection-time allowlist (workspace.read/watch);
  // that is workbench-server's #checkCapability, which owns the actual
  // authorization decision.
  if (capabilities !== undefined) {
    if (!Array.isArray(capabilities) || !capabilities.every((item): item is string => typeof item === "string")) {
      throw new Error("native Workbench capabilities are invalid")
    }
    const unknown = capabilities.filter((item) => !KNOWN_CAPABILITIES.has(item))
    if (unknown.length > 0) throw new Error(`native Workbench capabilities are unknown: ${unknown.join(", ")}`)
  }
  return {
    action,
    workspacePath: typeof input.workspacePath === "string" ? input.workspacePath : undefined,
    workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : undefined,
    capabilities: capabilities as P3Capability[] | undefined,
  }
}

/**
 * Private Workbench surface mounted inside the authenticated Unifia sidecar.
 * The normal Workbench routes use WorkbenchServer authentication; the native
 * control surface additionally requires the random keychain IPC token.
 */
export function createWorkbenchBridge(): WorkbenchBridge | undefined {
  const password = process.env.UNIFIA_SERVER_PASSWORD
  const ipcToken = process.env.UNIFIA_KEYCHAIN_TOKEN
  if (!password || !ipcToken) return undefined

  const signingKey = createHash("sha256").update(password, "utf8").digest("hex")
  const workspaceRoots = new Map<string, string>()
  const app = createWorkbenchApp({
    signingKey,
    issuer: "unifia-local",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "opencode",
    // WHY not process.cwd(): the sidecar inherits the launcher's working
    // directory. Started from a desktop shortcut on Windows that is
    // C:\WINDOWS\system32, where mkdir fails with EPERM and used to abort
    // the whole sidecar at startup. The audit trail belongs to the user's
    // data dir, which is writable and identical however the app was launched.
    auditLogPath: process.env.UNIFIA_WORKBENCH_AUDIT_LOG ?? path.join(Global.Path.data, "workbench-audit.jsonl"),
    rateBudget: 240,
    rateWindowMs: 60_000,
    // Read/watch are the baseline capabilities requested by the native Work
    // surface; writes and installs still go through the approval broker.
    allowlistedCapabilities: new Set(["workspace.read", "workspace.watch"] as P3Capability[]),
  }, {
    backend: new OpenCodeSessionBackend(),
    designSkills: async () => {
      const root = process.env.UNIFIA_DESIGN_TEMPLATES_DIR ?? path.join(process.cwd(), "templates", "design")
      const discovered = await discoverTemplates(root)
      return discovered.templates.map((template) => template.manifest)
    },
    pty: {
      async list(workspaceId) {
        const root = workspaceRoots.get(workspaceId)
        if (!root) return []
        const sessions = await Pty.list()
        return sessions.filter((session) => session.cwd === root || session.cwd.startsWith(`${root}${path.sep}`))
      },
      async create(workspaceId, input) {
        const root = workspaceRoots.get(workspaceId)
        if (!root) throw new Error("workspace is not registered for PTY")
        const requested = typeof input.cwd === "string" ? input.cwd : "."
        const cwd = path.resolve(root, requested)
        if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) throw new Error("PTY cwd escapes workspace")
        return Pty.create({ ...input, cwd, args: Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === "string") : undefined, command: typeof input.command === "string" ? input.command : undefined, title: typeof input.title === "string" ? input.title : undefined, cols: typeof input.cols === "number" ? input.cols : undefined, rows: typeof input.rows === "number" ? input.rows : undefined })
      },
      async update(workspaceId, ptyId, input) {
        const root = workspaceRoots.get(workspaceId); const current = await Pty.get(PtyID.make(ptyId))
        if (!root || !current || (current.cwd !== root && !current.cwd.startsWith(`${root}${path.sep}`))) throw new Error("PTY is not owned by workspace")
        const updated = await Pty.update(PtyID.make(ptyId), { title: typeof input.title === "string" ? input.title : undefined, size: input.size && typeof input.size === "object" ? input.size as { rows: number; cols: number } : undefined })
        if (!updated) throw new Error("PTY disappeared during update")
        return updated
      },
      async remove(workspaceId, ptyId) {
        const root = workspaceRoots.get(workspaceId); const current = await Pty.get(PtyID.make(ptyId))
        if (!root || !current || (current.cwd !== root && !current.cwd.startsWith(`${root}${path.sep}`))) throw new Error("PTY is not owned by workspace")
        await Pty.remove(PtyID.make(ptyId)); return true
      },
      async connect(workspaceId, ptyId, socket, cursor) {
        const root = workspaceRoots.get(workspaceId)
        const current = await Pty.get(PtyID.make(ptyId))
        if (!root || !current || (current.cwd !== root && !current.cwd.startsWith(`${root}${path.sep}`))) return undefined
        return Pty.connect(PtyID.make(ptyId), socket, cursor)
      },
    },
    github: {
      async status() {
        const identity = await GithubAuth.getIdentity()
        return {
          connected: Boolean(identity),
          configured: GithubAuth.isConfigured(),
          ...(identity ? { identity } : {}),
        }
      },
      async deviceStart() {
        return { ...(await GithubAuth.startDeviceFlow()) }
      },
      async devicePoll() {
        return { ...(await GithubAuth.pollDeviceFlow()) }
      },
      async deviceCancel() {
        GithubAuth.cancelDeviceFlow()
        return { ok: true }
      },
      async disconnect() {
        await GithubAuth.disconnect()
        return { ok: true }
      },
    },
  })

  const native = async (request: Request): Promise<Response> => {
    if (request.method !== "POST" || !sameSecret(ipcToken, request.headers.get("x-unifia-keychain-token"))) return json(401, { error: "native Workbench authorization required" })
    try {
      const input = readInput(await request.json())
      const capabilities = input.capabilities ?? ["workspace.read", "workspace.watch"]
      if (input.action === "open") {
        if (!input.workspacePath) return json(400, { error: "workspacePath is required" })
        const workspace = await app.workspace.register({ name: path.basename(input.workspacePath), path: input.workspacePath })
        workspaceRoots.set(workspace.id, workspace.path)
        return json(200, { workspaceId: workspace.id, instanceId: app.server.instanceId })
      }
      if (!input.workspaceId) return json(400, { error: "workspaceId is required" })
      if (input.action === "revoke") {
        await app.server.revokeNativeScopedToken(input.workspaceId)
        return json(200, { revoked: true })
      }
      const requestData = { principalId: NATIVE_PRINCIPAL, workspaceId: input.workspaceId, capabilities }
      if (input.action === "rotate") return json(200, await app.server.rotateNativeScopedToken(requestData) as unknown as Record<string, unknown>)
      return json(200, await app.server.issueNativeScopedToken(requestData) as unknown as Record<string, unknown>)
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : "native Workbench request failed" })
    }
  }

  const fetch = (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const pathName = url.pathname.replace(/^\/workbench/, "") || "/"
    return app.server.fetch(new Request(new URL(`${pathName}${url.search}`, url), request))
  }
  const ptyConnect = (request: Request, workspaceId: string, ptyId: string, socket: WorkbenchPtySocket, cursor?: number) => {
    return app.server.connectPty(request, workspaceId, ptyId, socket, cursor)
  }
  return { app, fetch, native, ptyConnect }
}
