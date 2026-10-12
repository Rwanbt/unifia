/* SPDX-License-Identifier: MIT */
/**
 * How the events route (`/ws/events`) authenticates its upgrade. The query string is not an authentication channel: a URL is
 * written to proxy and access logs, so a token in it is refused, and it does not name the connection. The route takes the
 * identity the auth middleware verified for the request.
 *
 * The route runs behind the real middleware. The server is a stub that records what the route asks the upgrade for.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { JwtAuth } from "../../src/server/auth-jwt"
import { WsEventRoutes } from "../../src/server/routes/ws-event"
import { holdCredentials } from "../../src/flag/held-credentials"
import { User } from "../../src/user"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const PASSWORD = "ws-events-password-0123456789"
const URL_EVENTS = "http://127.0.0.1:4096/ws/events"
const UPGRADE = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Version": "13",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
}

/** The events route behind the auth middleware, as the server mounts it. */
function eventsApp(): Hono {
  return new Hono().use(JwtAuth.middleware()).route("/ws", WsEventRoutes())
}

/** A stub of the server's WebSocket upgrade: it records the data each upgrade is given, and accepts it. */
function stubServer() {
  const upgrades: { data: { userID?: string; username?: string; role?: string } }[] = []
  const env = {
    server: {
      upgrade: (_request: Request, options: { data: { userID?: string; username?: string; role?: string } }) => {
        upgrades.push(options)
        return true
      },
    },
  }
  return { upgrades, env }
}

async function registered(username: string) {
  const user = await User.register({ username, password: `${username}-password-0123456789`, role: "admin" })
  return { user, accessToken: JwtAuth.issue(user).accessToken }
}

afterEach(() => holdCredentials({}))

describe("the events route on a server with a password", () => {
  beforeEach(() => holdCredentials({ password: PASSWORD }))

  test("an access token that is only in the query string is refused, and no connection is made", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const { accessToken } = await registered("events-query-owner")
        const server = stubServer()

        const response = await eventsApp().fetch(
          new Request(`${URL_EVENTS}?token=${accessToken}`, { headers: UPGRADE }),
          server.env,
        )

        expect(response.status).toBe(401)
        expect(server.upgrades).toHaveLength(0)
      },
    })
  })

  test("an access token in the Authorization header is accepted, and the connection is its user", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const { user, accessToken } = await registered("events-header-owner")
        const server = stubServer()

        const response = await eventsApp().fetch(
          new Request(URL_EVENTS, { headers: { ...UPGRADE, Authorization: `Bearer ${accessToken}` } }),
          server.env,
        )

        expect(response.status).toBe(101)
        expect(server.upgrades).toHaveLength(1)
        expect(server.upgrades[0]?.data.userID).toBe(user.id)
      },
    })
  })

  test("a WS ticket in the Sec-WebSocket-Protocol header is accepted, and the connection is its user", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const { user } = await registered("events-ticket-owner")
        const ticket = JwtAuth.issueWsTicket({ id: user.id, username: user.username, role: user.role })
        const server = stubServer()

        const response = await eventsApp().fetch(
          new Request(URL_EVENTS, { headers: { ...UPGRADE, "Sec-WebSocket-Protocol": `bearer, ${ticket}` } }),
          server.env,
        )

        expect(response.status).toBe(101)
        expect(server.upgrades[0]?.data.userID).toBe(user.id)
      },
    })
  })
})

describe("the events route on a server without a password", () => {
  test("a token in the query string does not name the connection", async () => {
    holdCredentials({})
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const { user, accessToken } = await registered("events-anonymous-owner")
        const server = stubServer()

        const response = await eventsApp().fetch(
          new Request(`${URL_EVENTS}?token=${accessToken}`, { headers: UPGRADE }),
          server.env,
        )

        expect(response.status).toBe(101)
        expect(server.upgrades[0]?.data.userID).toBe("anonymous")
        expect(server.upgrades[0]?.data.userID).not.toBe(user.id)
      },
    })
  })
})
