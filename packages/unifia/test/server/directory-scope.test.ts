/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Flag } from "../../src/flag/flag"
import { JwtAuth } from "../../src/server/auth-jwt"
import { User } from "../../src/user"

// A caller other than the owner works in the server's own project directory: the one a request gets when it names no
// directory. Another directory, named by the query or the header, or a workspace, is the owner's.
const PASSWORD = "owner-password-directory-scope-test"
const REFUSAL = { error: "Not authorized for this action" }

type Who = "owner" | "admin" | "member" | "viewer"

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
    const user = await User.register({ username: `scope-${role}-${stamp}`, password: "correct horse battery", role })
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

function get(who: Who, route: string, headers: Record<string, string> = {}): Promise<Response> {
  return server.fetch(route, { headers: { Authorization: authorization(who), ...headers } })
}

const ownDirectory = process.cwd()

describe("a caller other than the owner works in the server's own project directory", () => {
  test("a viewer and a member are refused for another directory, on the reads", async () => {
    await using project = await tmpdir({ git: true })
    const other = encodeURIComponent(project.path)
    for (const who of ["viewer", "member"] as const) {
      for (const route of [`/session?directory=${other}`, `/file/status?directory=${other}`, `/git/log?directory=${other}`]) {
        const response = await get(who, route)
        expect({ who, route, status: response.status }).toEqual({ who, route, status: 403 })
        expect(await response.json()).toEqual(REFUSAL)
      }
    }
  })

  test("an admin account is refused for another directory too: the rule is the owner's, not the admin role's", async () => {
    await using project = await tmpdir({ git: true })
    const response = await get("admin", `/session?directory=${encodeURIComponent(project.path)}`)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(REFUSAL)
  })

  test("the directory named by the header is the same resource, and is refused the same way", async () => {
    await using project = await tmpdir({ git: true })
    const response = await get("member", "/session", { "x-unifia-directory": project.path })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(REFUSAL)
  })

  test("a workspace, which selects another directory, is refused for a non-owner", async () => {
    const response = await get("member", "/session?workspace=ws_missing")
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(REFUSAL)
  })

  test("the server's own directory, named or not, is answered", async () => {
    expect((await get("member", "/session")).status).toBe(200)
    expect((await get("member", `/session?directory=${encodeURIComponent(ownDirectory)}`)).status).toBe(200)
    expect((await get("viewer", `/session?directory=${encodeURIComponent(ownDirectory)}`)).status).toBe(200)
  })

  test("the owner works in another directory", async () => {
    await using project = await tmpdir({ git: true })
    const response = await get("owner", `/session?directory=${encodeURIComponent(project.path)}`)
    expect(response.status).toBe(200)
  })
})
