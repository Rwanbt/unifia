/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { Flag } from "../../src/flag/flag"
import { JwtAuth } from "../../src/server/auth-jwt"
import { User } from "../../src/user"

// Credential writes and reads are the owner's: a provider key, a git token or key, a GitHub connection, a provider's
// OAuth, and an MCP server's OAuth. A refusal is the fixed answer, and it sends nothing outside the process.
const PASSWORD = "owner-password-credential-routes-test"
const REFUSAL = { error: "Not authorized for this action" }
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

type Who = "owner" | "admin" | "member" | "viewer"
type Call = readonly [method: string, path: string, body?: unknown]

let server: InProcessServer
let savedPassword: string | undefined
const tokens = new Map<Exclude<Who, "owner">, string>()

beforeAll(async () => {
  savedPassword = Flag.UNIFIA_SERVER_PASSWORD
  // @ts-expect-error test-only override, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
  server = await withInProcessServer({ password: PASSWORD })
  const stamp = Date.now()
  for (const role of ["viewer", "member", "admin"] as const) {
    const user = await User.register({ username: `cred-${role}-${stamp}`, password: "correct horse battery", role })
    tokens.set(role, JwtAuth.issue(user).accessToken)
  }
})

afterAll(async () => {
  await server.close()
  // @ts-expect-error restoring the value captured in beforeAll
  Flag.UNIFIA_SERVER_PASSWORD = savedPassword
})

/**
 * Run `body` with every non-loopback request intercepted: it is recorded and answered with a synthetic response, and
 * the network is never reached for it. Returns the intercepted URLs.
 */
async function interceptOutbound(body: () => Promise<void>): Promise<string[]> {
  const intercepted: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return original(input, init)
    intercepted.push(url.href)
    return new Response("intercepted by test: no outbound request is made", { status: 599 })
  }) as typeof fetch
  try {
    await body()
  } finally {
    globalThis.fetch = original
  }
  return intercepted
}

function authorization(who: Who): string {
  if (who === "owner") return "Basic " + Buffer.from(`unifia:${PASSWORD}`, "utf8").toString("base64")
  return `Bearer ${tokens.get(who)}`
}

function send(who: Who, [method, path, body]: Call): Promise<Response> {
  return server.fetch(path, {
    method,
    headers: {
      Authorization: authorization(who),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const CREDENTIAL_ROUTES: Call[] = [
  ["PUT", "/auth/r3-provider", { type: "api", key: "r3-refused-key" }],
  ["DELETE", "/auth/r3-provider"],
  ["GET", "/git/credentials"],
  ["PUT", "/git/credentials", { type: "https-token", token: "r3-refused-token" }],
  ["POST", "/github/device/start"],
  ["POST", "/github/device/poll", {}],
  ["POST", "/github/disconnect"],
  ["POST", "/github/test-connection"],
  ["POST", "/provider/r3-provider/oauth/authorize", {}],
  ["POST", "/provider/r3-provider/oauth/callback", {}],
  ["POST", "/mcp/r3-server/auth"],
  ["POST", "/mcp/r3-server/auth/callback", {}],
  ["POST", "/mcp/r3-server/auth/authenticate"],
  ["DELETE", "/mcp/r3-server/auth"],
]

describe("credential routes are the owner's", () => {
  for (const call of CREDENTIAL_ROUTES) {
    test(`${call[0]} ${call[1]} refuses every account, and sends nothing outside the process`, async () => {
      const seen: Array<{ who: Who; status: number; body: unknown }> = []
      const outbound = await interceptOutbound(async () => {
        for (const who of ["viewer", "member", "admin"] as const) {
          const response = await send(who, call)
          seen.push({ who, status: response.status, body: await response.json().catch(() => null) })
        }
      })
      expect(seen).toEqual([
        { who: "viewer", status: 403, body: REFUSAL },
        { who: "member", status: 403, body: REFUSAL },
        { who: "admin", status: 403, body: REFUSAL },
      ])
      expect(outbound).toEqual([])
    })
  }
})

describe("the owner's credential writes succeed", () => {
  test("a provider key is stored and removed", async () => {
    const outbound = await interceptOutbound(async () => {
      const stored = await send("owner", ["PUT", "/auth/r3-provider", { type: "api", key: "r3-owner-key" }])
      expect(stored.status).toBe(200)
      expect(await stored.json()).toBe(true)
      const removed = await send("owner", ["DELETE", "/auth/r3-provider"])
      expect(removed.status).toBe(200)
      expect(await removed.json()).toBe(true)
    })
    expect(outbound).toEqual([])
  })

  test("the git credentials are set and read by the owner", async () => {
    const outbound = await interceptOutbound(async () => {
      const set = await send("owner", ["PUT", "/git/credentials", { type: "none" }])
      expect(set.status).toBe(200)
      expect(await set.json()).toEqual({ ok: true })
      const read = await send("owner", ["GET", "/git/credentials"])
      expect(read.status).toBe(200)
    })
    expect(outbound).toEqual([])
  })

  test("the owner reaches the GitHub cancel and disconnect routes", async () => {
    const outbound = await interceptOutbound(async () => {
      expect((await send("owner", ["POST", "/github/device/cancel"])).status).toBe(200)
      expect((await send("owner", ["POST", "/github/disconnect"])).status).not.toBe(403)
    })
    expect(outbound).toEqual([])
  })
})
