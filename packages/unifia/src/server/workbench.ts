/* SPDX-License-Identifier: MIT */

import { createHash, timingSafeEqual } from "node:crypto"
import path from "node:path"
import { createWorkbenchApp, type WorkbenchApp } from "@unifia/workbench-server/bootstrap"
import { P3_CAPABILITIES, type P3Capability } from "@unifia/contracts"
import { OpenCodeSessionBackend } from "../unifia/opencode-runtime-backend"

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
  const app = createWorkbenchApp({
    signingKey,
    issuer: "unifia-local",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "opencode",
    auditLogPath: process.env.UNIFIA_WORKBENCH_AUDIT_LOG ?? path.join(process.cwd(), ".unifia", "workbench-audit.jsonl"),
    rateBudget: 240,
    rateWindowMs: 60_000,
    // Read/watch are the baseline capabilities requested by the native Work
    // surface; writes and installs still go through the approval broker.
    allowlistedCapabilities: new Set(["workspace.read", "workspace.watch"] as P3Capability[]),
  }, { backend: new OpenCodeSessionBackend() })

  const native = async (request: Request): Promise<Response> => {
    if (request.method !== "POST" || !sameSecret(ipcToken, request.headers.get("x-unifia-keychain-token"))) return json(401, { error: "native Workbench authorization required" })
    try {
      const input = readInput(await request.json())
      const capabilities = input.capabilities ?? ["workspace.read", "workspace.watch"]
      if (input.action === "open") {
        if (!input.workspacePath) return json(400, { error: "workspacePath is required" })
        const workspace = await app.workspace.register({ name: path.basename(input.workspacePath), path: input.workspacePath })
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
  return { app, fetch, native }
}
