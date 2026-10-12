/* SPDX-License-Identifier: MIT */
/**
 * How a WebSocket upgrade authenticates. The owner's credential must never travel in a URL: a proxy or an access log in front
 * of the sidecar would record it. The handshake takes a WS ticket in the Sec-WebSocket-Protocol header, or the Basic
 * credential in the Authorization header. A ticket is not an HTTP credential, and the query string is not read at all.
 *
 * The probe tests run the real auth middleware on real Request objects. The socket tests run the real server, and the real
 * PTY route, so the answer is the one a terminal would get.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { JwtAuth } from "../../src/server/auth-jwt"
import { holdCredentials } from "../../src/flag/held-credentials"
import { Flag } from "../../src/flag/flag"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"

const PASSWORD = "ws-handshake-password-0123456789"
const AUTH = `Basic ${Buffer.from(`unifia:${PASSWORD}`).toString("base64")}`
const OWNER = { id: "basic-auth", username: "unifia", role: "admin" as const }
const ROUTE = "/pty/pty_0000000000000000/connect"

/** The headers a browser sends on a WebSocket upgrade. */
function upgrade(headers: Record<string, string> = {}): Record<string, string> {
  return {
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    ...headers,
  }
}

/** The auth middleware in front of a route that answers 200 when it is reached. */
function probe(): Hono {
  return new Hono()
    .use(JwtAuth.middleware())
    .get("/pty/:id/connect", (c) => c.text("reached"))
}

afterEach(() => holdCredentials({}))

describe("a WebSocket upgrade on a server with a password", () => {
  beforeEach(() => holdCredentials({ password: PASSWORD }))

  test("the Basic credential in the query string is refused: the URL is not an authentication channel", async () => {
    const url = `http://127.0.0.1:4096${ROUTE}?authorization=${encodeURIComponent(AUTH)}`
    const response = await probe().fetch(new Request(url, { headers: upgrade() }))
    expect(response.status).toBe(401)
  })

  test("a WS ticket in the query string is refused as well", async () => {
    const ticket = JwtAuth.issueWsTicket(OWNER)
    const url = `http://127.0.0.1:4096${ROUTE}?authorization=${encodeURIComponent(`Bearer ${ticket}`)}`
    const response = await probe().fetch(new Request(url, { headers: upgrade() }))
    expect(response.status).toBe(401)
  })

  test("a WS ticket in the Sec-WebSocket-Protocol header is accepted, and the server selects bearer", async () => {
    const ticket = JwtAuth.issueWsTicket(OWNER)
    const response = await probe().fetch(
      new Request(`http://127.0.0.1:4096${ROUTE}`, { headers: upgrade({ "Sec-WebSocket-Protocol": `bearer, ${ticket}` }) }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("sec-websocket-protocol")).toBe("bearer")
  })

  test("a WS ticket is not an HTTP credential: as a Bearer token on an ordinary request it is refused", async () => {
    const ticket = JwtAuth.issueWsTicket(OWNER)
    const response = await probe().fetch(
      new Request(`http://127.0.0.1:4096${ROUTE}`, { headers: { Authorization: `Bearer ${ticket}` } }),
    )
    expect(response.status).toBe(401)
  })
})

describe("a WebSocket upgrade on a local server without a password", () => {
  test("it still connects with no credentials, as the terminal sends none", async () => {
    holdCredentials({})
    expect(Flag.UNIFIA_SERVER_PASSWORD).toBeUndefined()
    const response = await probe().fetch(new Request(`http://127.0.0.1:4096${ROUTE}`, { headers: upgrade() }))
    expect(response.status).toBe(200)
  })
})

describe("the PTY route on a real server, the answer a terminal gets", () => {
  let server: InProcessServer

  beforeAll(async () => {
    server = await withInProcessServer({ password: PASSWORD })
  })

  // The password the server checks is the held one: the harness's environment value is read at load, not here.
  beforeEach(() => holdCredentials({ password: PASSWORD }))

  afterAll(async () => {
    await server.close()
  })

  test("a terminal that puts the Basic credential in the URL is refused before the route answers", async () => {
    const response = await server.fetch(`${ROUTE}?authorization=${encodeURIComponent(AUTH)}`, { headers: upgrade() })
    expect(response.status).toBe(401)
  })

  test("a terminal that presents a WS ticket gets past authentication to the route, which answers that the session is absent", async () => {
    // The PTY id names no session, so the route's own check answers NotFound. That answer is reached only after the ticket has
    // authenticated: a refused ticket is a 401 before the route runs. Any other status is a different outcome, and fails here.
    const ticket = JwtAuth.issueWsTicket(OWNER)
    const response = await server.fetch(ROUTE, { headers: upgrade({ "Sec-WebSocket-Protocol": `bearer, ${ticket}` }) })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ name: "NotFoundError", data: { message: "Session not found" } })
  })
})
