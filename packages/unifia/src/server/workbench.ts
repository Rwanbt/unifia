/* SPDX-License-Identifier: MIT */

import { createHash, timingSafeEqual } from "node:crypto"
import path from "node:path"
import { createWorkbenchApp, type WorkbenchApp } from "@unifia/workbench-server/bootstrap"
import { SURFACE_GRANTED_CAPABILITIES, WORKBENCH_ALLOWED_ORIGINS } from "@unifia/workbench-server"
import { P3_CAPABILITIES, readWorkbenchIpcBearerFromEnv, type P3Capability } from "@unifia/contracts"
import { Global } from "../global/path"
import { OpenCodeSessionBackend } from "../unifia/opencode-runtime-backend"
import { discoverTemplates } from "@unifia/skill-hub/node"
import * as GithubAuth from "../github/auth"

type NativeTokenInput = {
  action: "open" | "issue" | "rotate" | "revoke"
  workspacePath?: string
  workspaceId?: string
  capabilities?: P3Capability[]
}

const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set(P3_CAPABILITIES)
/** Ten minutes: long enough to paste a share link somewhere, short enough that a leaked one stops working. */
const PRESENT_LINK_TTL_MS = 10 * 60_000

type WorkbenchBridge = {
  app: WorkbenchApp
  fetch(request: Request): Promise<Response>
  /** Desktop keychain path; 404 when no IPC bearer was provided. */
  native(request: Request): Promise<Response>
  /** ADR-041: caller already authenticated by the server middleware. */
  web(request: Request): Promise<Response>
}

const NATIVE_PRINCIPAL = "unifia-native-workbench"
// ADR-041: a distinct principal so the audit trail tells web leases apart.
const WEB_PRINCIPAL = "unifia-web-workbench"

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
  // D12 (§9.4 Lane D4) — migration boundary for the Workbench IPC
  // bearer. The new env var is `UNIFIA_WORKBENCH_BEARER`; the legacy
  // `UNIFIA_KEYCHAIN_TOKEN` is accepted until 2026-12-31 with a
  // deprecation warning (see ADR-1042). The `tryDecode*` inside
  // rejects a 32-byte base64 MobileEncryptionKey, so the bug where
  // the mobile path exported the encryption key under both names
  // (server.rs:267, 340-341) can no longer satisfy this call.
  const ipcToken = readWorkbenchIpcBearerFromEnv(process.env as Record<string, string | undefined>)
  // ADR-041: the password is what makes the server middleware authenticate
  // callers; without it the web route would mint leases for anyone, so the
  // whole bridge stays off. The IPC bearer only gates the native route.
  if (!password) return undefined

  const signingKey = createHash("sha256").update(password, "utf8").digest("hex")
  // Filled by the "open" token action below: the runtime backend needs each
  // workspace's directory to run inside its project instance.
  const workspaceDirectories = new Map<string, string>()
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
    // The Design surface writes for real — Fichiers CRUD, composer uploads,
    // artifact persistence, export, share links — and none of those have an
    // approval UI able to answer a 202, so gating them on the broker turned
    // every one into a silent 403 or a 202 the client read as success.
    // SURFACE_GRANTED_CAPABILITIES is pinned to the route registries by
    // workbench-shell's routes.test.ts. Installs, workflow runs and desktop
    // control are absent from it and still go through the broker.
    allowlistedCapabilities: new Set(SURFACE_GRANTED_CAPABILITIES),
    artifactRoot: Global.Path.data,
    presentLinkTtlMs: PRESENT_LINK_TTL_MS,
    // ADR-041: the Tauri origins plus the loopback web runtime, the same
    // localhost/127.0.0.1-any-port rule as the sidecar's own CORS policy.
    allowedOrigins: [...WORKBENCH_ALLOWED_ORIGINS, "http://localhost:*", "http://127.0.0.1:*"],
  }, {
    backend: new OpenCodeSessionBackend((workspaceId) => workspaceDirectories.get(workspaceId)),
    designSkills: async () => {
      const root = process.env.UNIFIA_DESIGN_TEMPLATES_DIR ?? path.join(process.cwd(), "templates", "design")
      const discovered = await discoverTemplates(root)
      return discovered.templates.map((template) => template.manifest)
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

  // One implementation for both callers; only the gate and the principal differ.
  const tokenAction = async (request: Request, principalId: string): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "Workbench token requests must be POST" })
    try {
      const input = readInput(await request.json())
      const capabilities = input.capabilities ?? ["workspace.read", "workspace.watch"]
      if (input.action === "open") {
        if (!input.workspacePath) return json(400, { error: "workspacePath is required" })
        const workspace = await app.workspace.register({ name: path.basename(input.workspacePath), path: input.workspacePath })
        workspaceDirectories.set(workspace.id, input.workspacePath)
        return json(200, { workspaceId: workspace.id, instanceId: app.server.instanceId })
      }
      if (!input.workspaceId) return json(400, { error: "workspaceId is required" })
      if (input.action === "revoke") {
        await app.server.revokeNativeScopedToken(input.workspaceId)
        return json(200, { revoked: true })
      }
      const requestData = { principalId, workspaceId: input.workspaceId, capabilities }
      if (input.action === "rotate") return json(200, await app.server.rotateNativeScopedToken(requestData) as unknown as Record<string, unknown>)
      return json(200, await app.server.issueNativeScopedToken(requestData) as unknown as Record<string, unknown>)
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : "Workbench token request failed" })
    }
  }

  const native = async (request: Request): Promise<Response> => {
    if (!ipcToken) return json(404, { error: "Workbench native bridge unavailable" })
    if (request.method !== "POST" || !sameSecret(ipcToken, request.headers.get("x-unifia-keychain-token"))) return json(401, { error: "native Workbench authorization required" })
    return tokenAction(request, NATIVE_PRINCIPAL)
  }

  const web = (request: Request): Promise<Response> => tokenAction(request, WEB_PRINCIPAL)

  const fetch = (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const pathName = url.pathname.replace(/^\/workbench/, "") || "/"
    return app.server.fetch(new Request(new URL(`${pathName}${url.search}`, url), request))
  }
  return { app, fetch, native, web }
}
