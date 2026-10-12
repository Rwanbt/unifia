/* SPDX-License-Identifier: MIT */
/**
 * The browser policy through the real server: what a page on another origin can do, and what the
 * desktop app, the embedded interface and command-line clients still can.
 *
 * Refusals are checked before credentials: a request that a browser may not make is answered 403 even
 * when it carries no credentials, so the answer does not depend on the auth path.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"
import { Server } from "../../src/server/server"
import { InvalidOriginError } from "../../src/server/browser-origin"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"

const PASSWORD = "browser-policy-test-pw"
const AUTH = "Basic " + Buffer.from("unifia:" + PASSWORD).toString("base64")
const EVIL = "https://evil.example"
const DEV_PAGE = "http://localhost:3000"
// A side-effect-free route under the global router, mounted at /global.
const HEALTH = "/global/health"

let savedPassword: string | undefined
let server: InProcessServer
let configured: InProcessServer

beforeAll(async () => {
  savedPassword = Flag.UNIFIA_SERVER_PASSWORD
  // @ts-expect-error test-only override, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
  server = await withInProcessServer({ password: PASSWORD })
  configured = await withInProcessServer({ password: PASSWORD, cors: [DEV_PAGE] })
})

afterAll(async () => {
  await configured.close()
  await server.close()
  // @ts-expect-error restoring the value captured in beforeAll
  Flag.UNIFIA_SERVER_PASSWORD = savedPassword
})

interface Call {
  method?: string
  origin?: string
  site?: string
  /** Credentials are sent unless this is false. */
  auth?: boolean
  headers?: Record<string, string>
}

function call(target: InProcessServer, path: string, input: Call = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(input.headers ?? {}) }
  if (input.auth !== false) headers.Authorization = AUTH
  if (input.origin !== undefined) headers.Origin = input.origin
  if (input.site !== undefined) headers["Sec-Fetch-Site"] = input.site
  return target.fetch(path, { method: input.method ?? "GET", headers })
}

async function refusedWith(response: Response): Promise<string | undefined> {
  expect(response.status).toBe(403)
  const body = (await response.json()) as { reason?: string }
  return body.reason
}

describe("a cross-origin browser request is refused before authentication and before any route", () => {
  test("a page on an unknown origin is refused even without credentials", async () => {
    const response = await call(server, HEALTH, { origin: EVIL, auth: false })
    expect(await refusedWith(response)).toBe("untrusted-origin")
  })

  test("a cross-site POST is refused even with valid credentials", async () => {
    const response = await call(server, "/session", { method: "POST", origin: EVIL, site: "cross-site" })
    expect(await refusedWith(response)).toBe("untrusted-origin")
  })

  test("a cross-site request with no Origin is refused on Fetch Metadata alone", async () => {
    const response = await call(server, HEALTH, { site: "cross-site" })
    expect(await refusedWith(response)).toBe("cross-site-request")
  })

  test("an opaque origin from a sandboxed frame is refused", async () => {
    const response = await call(server, HEALTH, { origin: "null", auth: false })
    expect(await refusedWith(response)).toBe("untrusted-origin")
  })

  test("another localhost port is refused, even on the same host, when it was not configured", async () => {
    const response = await call(server, HEALTH, { origin: DEV_PAGE, site: "same-site" })
    expect(await refusedWith(response)).toBe("untrusted-origin")
  })

  test("the Workbench routes, which skip authentication, are refused the same way", async () => {
    const response = await call(server, "/workbench/v1/anything", { method: "POST", origin: DEV_PAGE, auth: false })
    expect(await refusedWith(response)).toBe("untrusted-origin")
  })

  test("a WebSocket upgrade from an untrusted origin is refused before the handshake", async () => {
    const response = await call(server, "/events", {
      origin: EVIL,
      headers: { Upgrade: "websocket", Connection: "Upgrade" },
    })
    expect(await refusedWith(response)).toBe("untrusted-origin")
  })

  test("a request that names the attacker as its Host and as its Origin is refused, even with credentials", async () => {
    // The Host header is the request's own claim. Taking the server's origin from it lets a request trust itself.
    const response = await server.fetch(HEALTH, {
      headers: { Host: "attacker.test", Origin: "http://attacker.test", Authorization: AUTH },
    })
    expect(await refusedWith(response)).toBe("untrusted-origin")
  })

  test("the server's own origin is trusted whatever Host the request names", async () => {
    const response = await server.fetch(HEALTH, {
      headers: { Host: "attacker.test", Origin: server.url, Authorization: AUTH },
    })
    expect(response.status).toBe(200)
  })

  test("a refusal grants no CORS header, so the page cannot read it either", async () => {
    const response = await call(server, HEALTH, { origin: EVIL, auth: false })
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })
})

describe("legitimate clients keep working", () => {
  test("the packaged desktop webview reads responses from its own origin", async () => {
    const response = await call(server, HEALTH, { origin: "tauri://localhost", site: "cross-site" })
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost")
  })

  test("the desktop dev server on localhost:1420 reads responses from its origin", async () => {
    const response = await call(server, HEALTH, { origin: "http://localhost:1420", site: "same-site" })
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420")
  })

  test("the embedded interface, on the server's own origin, needs no CORS header", async () => {
    const own = server.url
    const response = await call(server, HEALTH, { origin: own, site: "same-origin" })
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("a command-line client, which sends no Origin, is served with its credentials", async () => {
    const response = await call(server, HEALTH)
    expect(response.status).toBe(200)
  })

  test("a request with no credentials is still refused by authentication, not by the browser policy", async () => {
    const response = await call(server, HEALTH, { auth: false })
    expect(response.status).toBe(401)
  })

  test("a configured dev origin is trusted by the server that lists it, and only by that server", async () => {
    const trusted = await call(configured, HEALTH, { origin: DEV_PAGE, site: "same-site" })
    expect(trusted.status).toBe(200)
    expect(trusted.headers.get("access-control-allow-origin")).toBe(DEV_PAGE)

    const untrusted = await call(server, HEALTH, { origin: DEV_PAGE, site: "same-site" })
    expect(await refusedWith(untrusted)).toBe("untrusted-origin")
  })
})

describe("a listener reachable from the network needs credentials", () => {
  test("a non-loopback address is refused without a password, before anything is bound", () => {
    const saved = Flag.UNIFIA_SERVER_PASSWORD
    // @ts-expect-error test-only override, restored below
    Flag.UNIFIA_SERVER_PASSWORD = undefined
    try {
      expect(() => Server.listen({ port: 0, hostname: "0.0.0.0" })).toThrow(
        /refusing to listen on 0\.0\.0\.0 without UNIFIA_SERVER_PASSWORD/,
      )
      expect(() => Server.listen({ port: 0, hostname: "192.168.1.20" })).toThrow(/refusing to listen/)
    } finally {
      // @ts-expect-error restoring the value captured above
      Flag.UNIFIA_SERVER_PASSWORD = saved
    }
  })
})

describe("a configuration that trusts too much stops the server at startup", () => {
  test("a port wildcard in the configured origins is refused when the routes are built", () => {
    expect(() => Server.ControlPlaneRoutes({ cors: ["http://localhost:*"] })).toThrow(InvalidOriginError)
  })

  test("a path in a configured origin is refused", () => {
    expect(() => Server.ControlPlaneRoutes({ cors: ["http://localhost:3000/app"] })).toThrow(InvalidOriginError)
  })
})
