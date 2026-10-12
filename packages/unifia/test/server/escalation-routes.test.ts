/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { Flag } from "../../src/flag/flag"
import { JwtAuth } from "../../src/server/auth-jwt"
import { User } from "../../src/user"

// Routes an administrator account must not reach. Each one runs a project's start command (a shell command), changes the
// project's commands or the configuration (which carries provider keys, base URLs and MCP servers' commands), or changes
// the Console account whose token the server uses. They are the owner's. Each probe sends a body its route's validator
// rejects, so a caller that reaches the route gets a 400 and nothing runs.
const PASSWORD = "owner-password-escalation-routes-test"
const REFUSAL = { error: "Not authorized for this action" }

type Who = "owner" | "admin" | "member" | "viewer"
type Call = readonly [method: string, path: string, body?: unknown]

const ESCALATION: Call[] = [
  ["POST", "/experimental/worktree", { startCommand: 42 }],
  ["POST", "/experimental/worktree/reset", { directory: 42 }],
  ["POST", "/experimental/workspace", {}],
  ["PATCH", "/project/prj_missing", { commands: 42 }],
  ["PATCH", "/config", { provider: 42 }],
  ["POST", "/experimental/console/switch", {}],
]

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
    const user = await User.register({ username: `esc-${role}-${stamp}`, password: "correct horse battery", role })
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

describe("the owner's routes are refused to an administrator account, and to every other account", () => {
  for (const call of ESCALATION) {
    test(`${call[0]} ${call[1]}`, async () => {
      for (const who of ["viewer", "member", "admin"] as const) {
        const response = await send(who, call)
        expect({ who, status: response.status }).toEqual({ who, status: 403 })
        expect(await response.json()).toEqual(REFUSAL)
      }
    })
  }

  test("the owner reaches each of them: the probe's validator answers, and nothing runs", async () => {
    for (const call of ESCALATION) {
      const response = await send("owner", call)
      expect({ call: `${call[0]} ${call[1]}`, status: response.status }).toEqual({
        call: `${call[0]} ${call[1]}`,
        status: 400,
      })
    }
  })
})
