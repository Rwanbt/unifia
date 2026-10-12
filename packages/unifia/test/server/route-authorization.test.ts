/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { Flag } from "../../src/flag/flag"
import { JwtAuth } from "../../src/server/auth-jwt"
import { User } from "../../src/user"

// The owner is the operator's basic credential. The other callers are real accounts, each with an access token.
const PASSWORD = "owner-password-route-authorization-test"
// The one answer a refused request receives: a fixed message, naming no route, class, directory or secret.
const REFUSAL = { error: "Not authorized for this action" }

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
    const user = await User.register({ username: `authz-${role}-${stamp}`, password: "correct horse battery", role })
    tokens.set(role, JwtAuth.issue(user).accessToken)
  }
})

afterAll(async () => {
  await server.close()
  // @ts-expect-error restoring the value captured in beforeAll
  Flag.UNIFIA_SERVER_PASSWORD = savedPassword
})

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

/** A refusal is the fixed answer: 403 and nothing else. */
async function expectRefused(who: Who, call: Call) {
  const response = await send(who, call)
  expect({ who, call: `${call[0]} ${call[1]}`, status: response.status }).toEqual({
    who,
    call: `${call[0]} ${call[1]}`,
    status: 403,
  })
  expect(await response.json()).toEqual(REFUSAL)
}

/**
 * An answer that is not the refusal. The calls passed here are ones whose body the route rejects before it does
 * anything, or that only read, so reaching the route has no effect.
 */
async function expectReached(who: Who, call: Call) {
  const response = await send(who, call)
  const body = await response.text()
  expect({ who, call: `${call[0]} ${call[1]}`, refused: response.status === 403 && body.includes(REFUSAL.error) }).toEqual({
    who,
    call: `${call[0]} ${call[1]}`,
    refused: false,
  })
}

// The owner-only execution routes the inventory names. A viewer and a member are refused on each.
const OWNER_ONLY_EXECUTION: Call[] = [
  ["GET", "/pty"],
  ["POST", "/pty", { command: 42 }],
  ["GET", "/pty/pty_missing/connect"],
  ["POST", "/agent-skills/does-not-exist/execute", {}],
  ["POST", "/session/ses_missing/shell", {}],
  ["POST", "/lsp/execute-command", {}],
  ["POST", "/mcp", {}],
  ["POST", "/mcp/does-not-exist/connect"],
  ["DELETE", "/mcp/does-not-exist"],
  ["POST", "/global/upgrade", { target: "not a version" }],
  ["PATCH", "/global/config", {}],
]

describe("the owner-only execution routes refuse a viewer and a member", () => {
  for (const call of OWNER_ONLY_EXECUTION) {
    test(`${call[0]} ${call[1]}`, async () => {
      await expectRefused("viewer", call)
      await expectRefused("member", call)
    })
  }

  test("the owner reaches each of them", async () => {
    for (const call of OWNER_ONLY_EXECUTION) await expectReached("owner", call)
  })

  test("the owner reads the terminal list and the configuration", async () => {
    expect((await send("owner", ["GET", "/pty"])).status).toBe(200)
    expect((await send("owner", ["PATCH", "/global/config", {}])).status).toBe(200)
  })
})

// The negative matrix. Each row is one action class. A viewer never reaches a route of a class it may not perform, by
// any of the routes listed. A refusal is the fixed answer whatever the route.
const MATRIX: Array<{ action: string; refusedFor: Who[]; calls: Call[] }> = [
  {
    action: "write-content (edit)",
    refusedFor: ["viewer"],
    calls: [
      ["POST", "/file/write", {}],
      ["DELETE", "/file", {}],
    ],
  },
  {
    action: "admin",
    refusedFor: ["viewer", "member"],
    calls: [
      ["GET", "/collab/users"],
      ["GET", "/audit"],
      ["GET", "/experimental/session"],
    ],
  },
  {
    action: "diagnostic",
    refusedFor: ["viewer", "member"],
    calls: [
      ["GET", "/path"],
      ["GET", "/disk"],
    ],
  },
  {
    action: "execute",
    refusedFor: ["viewer", "member", "admin"],
    calls: [
      ["GET", "/pty"],
      ["POST", "/pty", { command: 42 }],
      ["POST", "/session/ses_missing/shell", {}],
      ["POST", "/lsp/execute-command", {}],
      ["POST", "/agent-skills/does-not-exist/execute", {}],
    ],
  },
  {
    action: "credential",
    refusedFor: ["viewer", "member", "admin"],
    calls: [
      ["GET", "/git/credentials"],
      ["PUT", "/auth/anthropic", {}],
    ],
  },
  {
    action: "config",
    refusedFor: ["viewer", "member", "admin"],
    calls: [
      ["PATCH", "/global/config", {}],
      ["POST", "/mcp", {}],
      ["DELETE", "/mcp/does-not-exist"],
    ],
  },
]

describe("negative matrix: a caller never acquires a capability through another route", () => {
  for (const row of MATRIX) {
    test(`${row.action}: every route refuses the callers below its level`, async () => {
      for (const who of row.refusedFor) {
        for (const call of row.calls) await expectRefused(who, call)
      }
    })
  }

  test("the owner reaches every route of every row", async () => {
    for (const row of MATRIX) {
      for (const call of row.calls) await expectReached("owner", call)
    }
  })
})

describe("the levels below the owner keep what they may do", () => {
  test("a viewer reads the configuration, the session list and the provider list", async () => {
    expect((await send("viewer", ["GET", "/global/config"])).status).toBe(200)
    expect((await send("viewer", ["GET", "/session"])).status).toBe(200)
    expect((await send("viewer", ["GET", "/config/providers"])).status).toBe(200)
  })

  test("a member writes content: the log route is reached", async () => {
    await expectReached("member", ["POST", "/log", {}])
  })

  test("an admin account reads the user list and the audit log, and the disk", async () => {
    expect((await send("admin", ["GET", "/collab/users"])).status).toBe(200)
    expect((await send("admin", ["GET", "/audit"])).status).toBe(200)
    expect((await send("admin", ["GET", "/disk"])).status).toBe(200)
  })
})
