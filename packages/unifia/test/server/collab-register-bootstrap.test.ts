/* SPDX-License-Identifier: MIT */

// The first account belongs to the operator (ADR-091, section 3). POST /collab/register creates it only for a request
// authenticated with the operator's Basic credential. An anonymous request on an instance with no account is refused
// with 403 and creates nothing. Once an account exists, only an admin caller may register.
//
// With an operator password configured, the JWT middleware answers an anonymous request with 401 before the route runs,
// as it does for every route. The route's own 403 is reached only when no password is configured, so those tests
// unset the password on purpose.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"
import { JwtAuth } from "../../src/server/auth-jwt"
import { Server } from "../../src/server/server"
import { User } from "../../src/user"

const PASSWORD = "unifia-register-bootstrap-0123456789"
const savedPassword = Flag.UNIFIA_SERVER_PASSWORD
const operator = `Basic ${btoa(`unifia:${PASSWORD}`)}`
let app: ReturnType<typeof Server.ControlPlaneRoutes>

function setPassword(value: string | undefined) {
  // @ts-expect-error intentional test-only override of a Flag namespace member, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = value
}

async function register(body: { username: string; role?: string }, authorization?: string): Promise<Response> {
  return app.request("http://127.0.0.1/collab/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ password: "correct horse battery", ...body }),
  })
}

function clearAccounts() {
  for (const user of User.list()) User.remove(user.id)
}

beforeAll(() => {
  setPassword(PASSWORD)
  app = Server.ControlPlaneRoutes()
})

beforeEach(() => {
  clearAccounts()
  setPassword(PASSWORD)
})

afterAll(() => {
  clearAccounts()
  setPassword(savedPassword)
})

describe("POST /collab/register: the first account", () => {
  test("an anonymous first registration is refused and creates no account", async () => {
    setPassword(undefined)
    const response = await register({ username: "first-owner" })
    expect(response.status).toBe(403)
    expect(User.count()).toBe(0)
    expect(User.getByUsername("first-owner")).toBeNull()
  })

  test("with an operator password, an anonymous request is refused before registration and creates no account", async () => {
    const response = await register({ username: "first-owner" })
    expect(response.status).toBe(401)
    expect(User.count()).toBe(0)
  })

  test("the operator's Basic credential creates the first account as admin", async () => {
    const response = await register({ username: "first-owner" }, operator)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { user: { username: string; role: string } }
    expect(body.user).toMatchObject({ username: "first-owner", role: "admin" })
    expect(User.count()).toBe(1)
  })

  test("a wrong operator password creates no account", async () => {
    const response = await register({ username: "first-owner" }, `Basic ${btoa(`unifia:${PASSWORD}x`)}`)
    expect(response.status).toBe(401)
    expect(User.count()).toBe(0)
  })

  test("without an operator password no first account can be created, even with Basic credentials", async () => {
    setPassword(undefined)
    const response = await register({ username: "first-owner" }, `Basic ${btoa("unifia:anything")}`)
    expect(response.status).toBe(403)
    expect(User.count()).toBe(0)
  })
})

describe("POST /collab/register: after the first account", () => {
  beforeEach(async () => {
    await User.register({ username: "seeded-admin", password: "admin-password-1", role: "admin" })
  })

  test("a second anonymous registration is refused and creates no account", async () => {
    setPassword(undefined)
    const response = await register({ username: "second-user" })
    expect(response.status).toBe(403)
    expect(User.count()).toBe(1)
    expect(User.getByUsername("second-user")).toBeNull()
  })

  test("a member's access token cannot register an account", async () => {
    const member = await User.register({ username: "member-user", password: "member-password-1", role: "member" })
    const response = await register({ username: "second-user" }, `Bearer ${JwtAuth.issue(member).accessToken}`)
    expect(response.status).toBe(403)
    expect(User.count()).toBe(2)
  })

  test("an admin's access token can register a member", async () => {
    const admin = User.getByUsername("seeded-admin")!
    const response = await register({ username: "second-user" }, `Bearer ${JwtAuth.issue(admin).accessToken}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { user: { role: string } }
    expect(body.user.role).toBe("member")
    expect(User.count()).toBe(2)
  })
})
