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

  test("the shipped bridge wires the workflow runtime, so Automate is not answered 501", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    const bridge = createWorkbenchBridge()
    if (!bridge) throw new Error("bridge did not initialize with a server password")
    try {
      const opened = await bridge.web(post({ action: "open", workspacePath }))
      const workspace = (await opened.json()) as { workspaceId: string }
      const issued = await bridge.web(post({ action: "issue", workspaceId: workspace.workspaceId, capabilities: ["workspace.read"] }))
      const lease = (await issued.json()) as { token: string }
      const listed = await bridge.fetch(
        new Request(`http://127.0.0.1/workbench/v1/workflows?workspaceId=${encodeURIComponent(workspace.workspaceId)}`, {
          headers: { "x-unifia-file-session": lease.token },
        }),
      )
      expect(listed.status).toBe(200)
      expect(await listed.json()).toEqual({ workflows: [] })
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

    const viewer = await app.fetch(post(body, { Authorization: `Bearer ${await account("viewer")}` }), peer(LOOPBACK))
    expect(viewer.status).toBe(403)

    // A member on loopback (the desktop's own host). The request names its peer: a request with no peer is treated as
    // beyond loopback and meets the owner rule (ADR-094), so the peer is part of this expectation.
    const member = await app.fetch(post(body, { Authorization: `Bearer ${await account("member")}` }), peer(LOOPBACK))
    expect(member.status).toBe(200)
  })
})

/** A client at `address` of a server bound to `bound`, as the server's socket reports it (see native-route-authority). */
function peer(address: string, bound = "0.0.0.0") {
  return { hostname: bound, requestIP: () => ({ address }) } as never
}

const LOOPBACK = "127.0.0.1"
const REMOTE = "203.0.113.9"

describe("the web token route beyond loopback (ADR-094)", () => {
  // Fresh accounts per test: the usernames are unique, the bridge and the store are shared.
  const account = async (role: "admin" | "member" | "viewer") => {
    const user = await User.register({
      username: `wb-remote-${role}-${crypto.randomUUID().slice(0, 8)}`,
      password: "correct horse battery",
      role,
    })
    return JwtAuth.issue(user).accessToken
  }
  const basicOwner = `Basic ${btoa(`unifia:${PASSWORD}`)}`
  // A function: workspacePath is set in beforeAll, after this describe's body has run.
  const open = () => ({ action: "open", workspacePath })

  test("a remote member is refused for open and for issue, with 403", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    setFlagPassword(PASSWORD)
    const app = Server.ControlPlaneRoutes()
    const member = `Bearer ${await account("member")}`

    const opened = await app.fetch(post(open(), { Authorization: member }), peer(REMOTE))
    expect(opened.status).toBe(403)

    const ownerOpened = await app.fetch(post(open(), { Authorization: basicOwner }), peer(REMOTE))
    expect(ownerOpened.status).toBe(200)
    const { workspaceId } = (await ownerOpened.json()) as { workspaceId: string }

    const issued = await app.fetch(post({ action: "issue", workspaceId, capabilities: ["workspace.read"] }, { Authorization: member }), peer(REMOTE))
    expect(issued.status).toBe(403)
  })

  test("a remote member is refused for rotate and for revoke as well: the route is the owner's, not one action of it", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    setFlagPassword(PASSWORD)
    const app = Server.ControlPlaneRoutes()
    const member = `Bearer ${await account("member")}`
    for (const action of ["rotate", "revoke"]) {
      const response = await app.fetch(post({ action, workspaceId: "ws_unknown" }, { Authorization: member }), peer(REMOTE))
      expect(response.status).toBe(403)
    }
  })

  test("a remote admin access token that is not the owner's basic credential is refused with 403", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    setFlagPassword(PASSWORD)
    const app = Server.ControlPlaneRoutes()
    const admin = `Bearer ${await account("admin")}`
    const response = await app.fetch(post(open(), { Authorization: admin }), peer(REMOTE))
    expect(response.status).toBe(403)
  })

  test("the owner's basic credential is accepted from a remote client, for open and for issue", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    setFlagPassword(PASSWORD)
    const app = Server.ControlPlaneRoutes()
    const opened = await app.fetch(post(open(), { Authorization: basicOwner }), peer(REMOTE))
    expect(opened.status).toBe(200)
    const { workspaceId } = (await opened.json()) as { workspaceId: string }
    const issued = await app.fetch(post({ action: "issue", workspaceId, capabilities: ["workspace.read"] }, { Authorization: basicOwner }), peer(REMOTE))
    expect(issued.status).toBe(200)
  })

  test("a loopback member is accepted for open and for issue", async () => {
    process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
    setFlagPassword(PASSWORD)
    const app = Server.ControlPlaneRoutes()
    const member = `Bearer ${await account("member")}`
    const opened = await app.fetch(post(open(), { Authorization: member }), peer(LOOPBACK))
    expect(opened.status).toBe(200)
    const { workspaceId } = (await opened.json()) as { workspaceId: string }
    const issued = await app.fetch(post({ action: "issue", workspaceId, capabilities: ["workspace.read"] }, { Authorization: member }), peer(LOOPBACK))
    expect(issued.status).toBe(200)
  })
})
