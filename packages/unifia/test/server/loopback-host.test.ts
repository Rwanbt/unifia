/* SPDX-License-Identifier: MIT */
/**
 * A server bound to loopback, without credentials, answers only requests whose Host is loopback.
 * Credentials make the guard unnecessary: a page cannot send them under a rebinding host name.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { Flag } from "../../src/flag/flag"
import { isLoopbackAddress, isLoopbackHostHeader } from "../../src/server/loopback-host"

const PASSWORD = "loopback-host-test-pw"
const AUTH = "Basic " + Buffer.from("unifia:" + PASSWORD).toString("base64")

describe("isLoopbackHostHeader", () => {
  test("accepts loopback names and addresses, with or without the port", () => {
    expect(isLoopbackHostHeader("127.0.0.1:4096")).toBe(true)
    expect(isLoopbackHostHeader("127.0.0.2")).toBe(true)
    expect(isLoopbackHostHeader("localhost:4096")).toBe(true)
    expect(isLoopbackHostHeader("LOCALHOST")).toBe(true)
    expect(isLoopbackHostHeader("[::1]:4096")).toBe(true)
  })

  test("refuses a host name that is not loopback, as DNS rebinding sends it", () => {
    expect(isLoopbackHostHeader("evil.example:4096")).toBe(false)
    expect(isLoopbackHostHeader("localhost.evil.example:4096")).toBe(false)
    expect(isLoopbackHostHeader("127.0.0.1.evil.example")).toBe(false)
  })

  test("refuses a network address, an unspecified address, and a malformed one", () => {
    expect(isLoopbackHostHeader("192.168.1.20:4096")).toBe(false)
    expect(isLoopbackHostHeader("0.0.0.0:4096")).toBe(false)
    expect(isLoopbackHostHeader("127.0.0.01:4096")).toBe(false)
    expect(isLoopbackHostHeader("[2001:db8::1]:4096")).toBe(false)
  })

  test("refuses a missing Host", () => {
    expect(isLoopbackHostHeader(null)).toBe(false)
  })

  test("the bound address check accepts loopback and refuses every other address", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true)
    expect(isLoopbackAddress("::1")).toBe(true)
    expect(isLoopbackAddress("0.0.0.0")).toBe(false)
    expect(isLoopbackAddress("192.168.1.20")).toBe(false)
  })
})

describe("the server, without credentials, bound to loopback", () => {
  let server: InProcessServer
  let savedPassword: string | undefined

  beforeAll(async () => {
    savedPassword = Flag.UNIFIA_SERVER_PASSWORD
    // @ts-expect-error test-only override: no credentials configured
    Flag.UNIFIA_SERVER_PASSWORD = undefined
    server = await withInProcessServer({})
  })

  afterAll(async () => {
    await server.close()
    // @ts-expect-error restoring the value captured in beforeAll
    Flag.UNIFIA_SERVER_PASSWORD = savedPassword
  })

  test("a request addressed to a host name a page controls is refused, so a rebinding page reads nothing", async () => {
    const response = await server.fetch("/path", { headers: { Host: `evil.example:${server.port}` } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "untrusted request target" })
  })

  test("a request addressed to loopback is served as before", async () => {
    expect((await server.fetch("/path")).status).toBe(200)
    expect((await server.fetch("/path", { headers: { Host: `localhost:${server.port}` } })).status).toBe(200)
  })
})

describe("the server, with credentials, bound to loopback", () => {
  let server: InProcessServer
  let savedPassword: string | undefined

  beforeAll(async () => {
    savedPassword = Flag.UNIFIA_SERVER_PASSWORD
    // @ts-expect-error test-only override: credentials configured
    Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
    server = await withInProcessServer({ password: PASSWORD })
  })

  afterAll(async () => {
    await server.close()
    // @ts-expect-error restoring the value captured in beforeAll
    Flag.UNIFIA_SERVER_PASSWORD = savedPassword
  })

  test("without the credentials the request is refused by authentication, not by the Host guard", async () => {
    const response = await server.fetch("/path", { headers: { Host: `evil.example:${server.port}` } })
    expect(response.status).toBe(401)
  })

  test("with the credentials, the server answers whatever the Host, because a page cannot hold them", async () => {
    const response = await server.fetch("/path", {
      headers: { Host: `evil.example:${server.port}`, Authorization: AUTH },
    })
    expect(response.status).toBe(200)
  })
})
