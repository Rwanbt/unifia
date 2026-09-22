/* SPDX-License-Identifier: MIT */

// ADR-041 — the web runtime's Workbench lease route. The bridge must exist
// only with a server password, the native route must stay closed without the
// keychain IPC bearer, and POST /workbench-web/token must sit behind the
// server's own authentication (not the /workbench/* bypass).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Flag } from "../../src/flag/flag"
import { createWorkbenchBridge } from "../../src/server/workbench"
import { Server } from "../../src/server/server"
import { JwtAuth } from "../../src/server/auth-jwt"
import { User } from "../../src/user"

const PASSWORD = "unifia-web-bridge-password-0123456789"
const ENV_KEYS = ["UNIFIA_SERVER_PASSWORD", "UNIFIA_KEYCHAIN_TOKEN", "UNIFIA_WORKBENCH_BEARER", "UNIFIA_WORKBENCH_AUDIT_LOG"] as const
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
const savedFlagPassword = Flag.UNIFIA_SERVER_PASSWORD
let root = ""
let workspacePath = ""

function setFlagPassword(value: string | undefined) {
  // @ts-expect-error intentional test-only override of a Flag namespace member, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = value
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1/workbench-web/token", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unifia-workbench-web-"))
  workspacePath = path.join(root, "workspace")
  await mkdir(workspacePath)
  process.env.UNIFIA_WORKBENCH_AUDIT_LOG = path.join(root, "workbench-audit.jsonl")
  delete process.env.UNIFIA_KEYCHAIN_TOKEN
  delete process.env.UNIFIA_WORKBENCH_BEARER
})

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  setFlagPassword(savedFlagPassword)
  await rm(root, { recursive: true, force: true })
})

describe("Workbench web bridge (ADR-041)", () => {
  test("no server password: no bridge at all, so nothing can mint leases", () => {
    delete process.env.UNIFIA_SERVER_PASSWORD
    expect(createWorkbenchBridge()).toBeUndefined()
  })

  test("password without IPC bearer: web mints scoped leases, native stays closed", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    const bridge = createWorkbenchBridge()
    if (!bridge) throw new Error("bridge did not initialize with a server password")
    try {
      const native = await bridge.native(post({ action: "open", workspacePath }, { "x-unifia-keychain-token": "x" }))
      expect(native.status).toBe(404)

      const wrongMethod = await bridge.web(new Request("http://127.0.0.1/workbench-web/token"))
      expect(wrongMethod.status).toBe(405)

      const opened = await bridge.web(post({ action: "open", workspacePath }))
      expect(opened.status).toBe(200)
      const workspace = (await opened.json()) as { workspaceId: string; instanceId: string }

      const issued = await bridge.web(post({ action: "issue", workspaceId: workspace.workspaceId, capabilities: ["workspace.read"] }))
      expect(issued.status).toBe(200)
      const lease = (await issued.json()) as { token: string; workspaceId: string; instanceId: string }
      expect(lease.workspaceId).toBe(workspace.workspaceId)
      expect(lease.instanceId).toBe(workspace.instanceId)

      const listed = await bridge.fetch(
        new Request(`http://127.0.0.1/workbench/v1/files/list?workspaceId=${encodeURIComponent(workspace.workspaceId)}`, {
          headers: { "x-unifia-file-session": lease.token },
        }),
      )
      expect(listed.status).toBe(200)

      // Capability names are still checked against the canonical list.
      const unknown = await bridge.web(post({ action: "issue", workspaceId: workspace.workspaceId, capabilities: ["not-a-real-capability"] }))
      expect(unknown.status).toBe(400)
    } finally {
      await bridge.app.server.shutdown()
    }
  })

  test("the server route requires the server credentials", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    setFlagPassword(PASSWORD)
    const app = Server.ControlPlaneRoutes()
    const body = { action: "open", workspacePath }

    const anonymous = await app.request(post(body))
    expect(anonymous.status).toBe(401)

    const wrong = await app.request(post(body, { Authorization: `Basic ${btoa("unifia:wrong")}` }))
    expect(wrong.status).toBe(401)

    const authorized = await app.request(post(body, { Authorization: `Basic ${btoa(`unifia:${PASSWORD}`)}` }))
    expect(authorized.status).toBe(200)
    const opened = (await authorized.json()) as { workspaceId?: string }
    expect(opened.workspaceId).toBeTruthy()
  })

  test("a read-only collaborative account cannot obtain a lease (/cso finding 1)", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    setFlagPassword(PASSWORD)
    const app = Server.ControlPlaneRoutes()
    // Real accounts: JwtAuth.issue persists a refresh token that references
    // collab_user (and exercises the 20260922200000 migration).
    const account = async (role: "viewer" | "member") => {
      const user = await User.register({ username: `wb-${role}-${Date.now()}`, password: "correct horse battery", role })
      return JwtAuth.issue(user).accessToken
    }
    const body = { action: "open", workspacePath }

    const viewer = await app.request(post(body, { Authorization: `Bearer ${await account("viewer")}` }))
    expect(viewer.status).toBe(403)

    const member = await app.request(post(body, { Authorization: `Bearer ${await account("member")}` }))
    expect(member.status).toBe(200)
  })
})
