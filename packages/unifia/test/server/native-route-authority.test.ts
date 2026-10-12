/* SPDX-License-Identifier: MIT */
/**
 * The Workbench native token route, through the real control plane.
 *
 * On the desktop's own host (a client on loopback) the native token alone is the authority, as it always was. A client beyond
 * loopback must also present the owner's own authority: the basic credential of the instance owner (ADR-094). A verified admin
 * access token is not the owner, so it is refused beyond loopback. Each case calls the real app with the client's address, so
 * the decision is the one a socket would make.
 */

import { describe, it, expect, afterEach, beforeEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setSystemTime } from "bun:test"
import { Server } from "../../src/server/server"
import { JwtAuth } from "../../src/server/auth-jwt"
import { User } from "../../src/user"
import { holdCredentials } from "../../src/flag/held-credentials"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ipcBearer = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const PASSWORD = "owner-password-0123456789abcdef"
const URL_NATIVE = "http://127.0.0.1/workbench/native/token"
const savedEnv = { ...process.env }
let audit: string

beforeEach(async () => {
  audit = await mkdtemp(path.join(os.tmpdir(), "unifia-native-authority-"))
  process.env.UNIFIA_WORKBENCH_AUDIT_LOG = path.join(audit, "audit.jsonl")
  holdCredentials({ password: PASSWORD, keychainToken: ipcBearer })
})

afterEach(async () => {
  holdCredentials({})
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
  await rm(audit, { recursive: true, force: true })
})

/** A client on `address`, of a server bound to `bound`. Bun passes its server as the environment of each request. */
function env(bound: string, address: string) {
  return { hostname: bound, requestIP: () => ({ address }) }
}

function basic(password: string): string {
  return `Basic ${Buffer.from(`unifia:${password}`).toString("base64")}`
}

/** A token whose payload now says admin, under the signature the token had before: the signature no longer matches. */
function forgedAsAdmin(token: string): string {
  const [header, body, signature] = token.split(".")
  const payload = JSON.parse(Buffer.from(body!, "base64url").toString()) as Record<string, unknown>
  payload.role = "admin"
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`
}

function native(headers: Record<string, string>, body?: string): Request {
  return new Request(URL_NATIVE, { method: "POST", headers: { "content-type": "application/json", ...headers }, body })
}

/** The request that opens a workspace: a real action, so an authorized call is answered by the route's own handler. */
function opening(workspacePath: string): string {
  return JSON.stringify({ action: "open", workspacePath })
}

/** The workspace id of an answer that opened one. */
async function openedWorkspace(response: Response): Promise<unknown> {
  return ((await response.json()) as { workspaceId?: unknown }).workspaceId
}

describe("the native token route on the desktop's own host", () => {
  it("a client on loopback needs only the native token, as before", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const app = Server.ControlPlaneRoutes()
        const response = await app.fetch(
          native({ "x-unifia-keychain-token": ipcBearer }, opening(project.path)),
          env("127.0.0.1", "127.0.0.1") as never,
        )
        expect(response.status).toBe(200)
        expect(typeof (await openedWorkspace(response))).toBe("string")
      },
    })
  })

  it("a loopback client with the wrong native token is refused by the token gate", async () => {
    const app = Server.ControlPlaneRoutes()
    const response = await app.fetch(native({ "x-unifia-keychain-token": "wrong" }), env("127.0.0.1", "127.0.0.1") as never)
    expect(response.status).toBe(401)
  })
})

describe("the native token route beyond loopback", () => {
  const remote = "203.0.113.9"

  it("a remote client with the right native token and no owner authority is refused", async () => {
    const app = Server.ControlPlaneRoutes()
    const response = await app.fetch(native({ "x-unifia-keychain-token": ipcBearer }), env("0.0.0.0", remote) as never)
    expect(response.status).toBe(401)
  })

  it("a remote client with the basic credential of the owner and the native token is accepted", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const app = Server.ControlPlaneRoutes()
        const response = await app.fetch(
          native({ "x-unifia-keychain-token": ipcBearer, authorization: basic(PASSWORD) }, opening(project.path)),
          env("0.0.0.0", remote) as never,
        )
        expect(response.status).toBe(200)
        expect(typeof (await openedWorkspace(response))).toBe("string")
      },
    })
  })

  it("a remote client with a wrong basic credential is refused", async () => {
    const app = Server.ControlPlaneRoutes()
    const response = await app.fetch(
      native({ "x-unifia-keychain-token": ipcBearer, authorization: basic("not-the-password") }),
      env("0.0.0.0", remote) as never,
    )
    expect(response.status).toBe(401)
  })

  it("a remote client with the owner's credential but the wrong native token is refused by the token gate", async () => {
    const app = Server.ControlPlaneRoutes()
    const response = await app.fetch(
      native({ "x-unifia-keychain-token": "wrong", authorization: basic(PASSWORD) }),
      env("0.0.0.0", remote) as never,
    )
    expect(response.status).toBe(401)
  })

  it("a remote client that is a viewer is refused, whatever its token", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const user = await User.register({ username: "viewer-remote", password: "viewer-password-0123456789", role: "viewer" })
        const viewer = JwtAuth.issue(user).accessToken
        const app = Server.ControlPlaneRoutes()
        const response = await app.fetch(
          native({ "x-unifia-keychain-token": ipcBearer, authorization: `Bearer ${viewer}` }),
          env("0.0.0.0", remote) as never,
        )
        expect(response.status).toBe(403)
      },
    })
  })

  it("a remote client with an admin access token that has expired is refused", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const user = await User.register({ username: "owner-expiry", password: "owner-password-expiry-0123456789", role: "admin" })
        const issuedAt = new Date("2026-10-12T12:00:00Z")
        setSystemTime(issuedAt)
        try {
          const admin = JwtAuth.issue(user).accessToken
          setSystemTime(new Date(issuedAt.getTime() + 16 * 60 * 1000))
          const app = Server.ControlPlaneRoutes()
          const response = await app.fetch(
            native({ "x-unifia-keychain-token": ipcBearer, authorization: `Bearer ${admin}` }),
            env("0.0.0.0", remote) as never,
          )
          expect(response.status).toBe(401)
        } finally {
          setSystemTime()
        }
      },
    })
  })

  it("a remote client with the access token of an admin who is not the owner is refused with 403", async () => {
    // Verified, of the admin role, and accepted by the memory routes as an admin. It is not the owner's basic credential,
    // so the owner's authority is not given to it (ADR-094, ADR-091).
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const user = await User.register({ username: "admin-not-owner", password: "admin-password-not-owner-0123456789", role: "admin" })
        const admin = JwtAuth.issue(user).accessToken
        const app = Server.ControlPlaneRoutes()
        const response = await app.fetch(
          native({ "x-unifia-keychain-token": ipcBearer, authorization: `Bearer ${admin}` }, opening(project.path)),
          env("0.0.0.0", remote) as never,
        )
        expect(response.status).toBe(403)
      },
    })
  })

  it("a remote client with an admin's WebSocket ticket is refused with 403: a ticket is not the owner's credential", async () => {
    // A ticket verifies as an admin principal whose way of verification is a ticket. The owner's authority is the basic credential
    // alone (ADR-094), so the ticket is refused, and the 403 shows that it verified: an unverified ticket would answer 401.
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const ticket = JwtAuth.issueWsTicket({ id: "usr_ticket_admin", username: "admin-ticket", role: "admin" })
        const app = Server.ControlPlaneRoutes()
        const response = await app.fetch(
          native(
            { "x-unifia-keychain-token": ipcBearer, upgrade: "websocket", "sec-websocket-protocol": `bearer,${ticket}` },
            opening(project.path),
          ),
          env("0.0.0.0", remote) as never,
        )
        expect(response.status).toBe(403)
      },
    })
  })

  it("a remote client with a token whose payload was altered to admin is refused with 401", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const user = await User.register({ username: "viewer-forged", password: "viewer-password-forged-0123456789", role: "viewer" })
        const viewer = JwtAuth.issue(user).accessToken
        const app = Server.ControlPlaneRoutes()
        const response = await app.fetch(
          native({ "x-unifia-keychain-token": ipcBearer, authorization: `Bearer ${forgedAsAdmin(viewer)}` }, opening(project.path)),
          env("0.0.0.0", remote) as never,
        )
        expect(response.status).toBe(401)
      },
    })
  })
})

describe("a request whose peer is not known is treated as beyond loopback", () => {
  // A request with no environment is one the server cannot place: the in-process callers pass none, and a socket
  // that reports no address gives none. Such a request must meet the owner gate, not the desktop's own-host rule.

  it("a call with no environment and only the native token is refused, as a remote client with no owner authority is", async () => {
    const app = Server.ControlPlaneRoutes()
    const response = await app.fetch(native({ "x-unifia-keychain-token": ipcBearer }))
    expect(response.status).toBe(401)
  })

  it("a bind address alone does not make the client local", async () => {
    const app = Server.ControlPlaneRoutes()
    const response = await app.fetch(native({ "x-unifia-keychain-token": ipcBearer }), { hostname: "127.0.0.1" } as never)
    expect(response.status).toBe(401)
  })
})

describe("the in-process callers are local, and keep the desktop's own-host rule", () => {
  it("the in-process environment reports a loopback peer, so the native token alone is accepted, as before", async () => {
    // A fresh app, not Server.Default(): the default app is a process-wide singleton, built by whichever test file asks
    // first. Built before this file holds the password, its Workbench bridge is absent and the route answers 404.
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const app = Server.ControlPlaneRoutes()
        const response = await app.fetch(
          native({ "x-unifia-keychain-token": ipcBearer }, opening(project.path)),
          Server.IN_PROCESS_ENV as never,
        )
        expect(response.status).toBe(200)
        expect(typeof (await openedWorkspace(response))).toBe("string")
      },
    })
  })
})
