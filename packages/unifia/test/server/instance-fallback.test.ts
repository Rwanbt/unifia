/* SPDX-License-Identifier: MIT */
/**
 * The catch-all for unknown routes must never send a request to a third-party host.
 *
 * An unknown route carries the caller's credentials and body. When the embedded interface
 * is absent, the catch-all used to forward the whole request to app.opencode.ai.
 *
 * These tests never reach the network. While they run, every outbound request to a host that
 * is not the loopback interface is intercepted: it is recorded and answered with a synthetic
 * response, and the real fetch is never called for it. A regression is therefore detected as a
 * recorded outbound request, and it cannot disclose anything, even when the defect is present.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"

const PASSWORD = "instance-fallback-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")
const THIRD_PARTY_HOST = "app.opencode.ai"
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])
const BLOCKED_STATUS = 599

let server: InProcessServer

beforeAll(async () => {
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

/**
 * Run `body` with every non-loopback request intercepted. Returns the URLs that were
 * intercepted. The real network is never reached for them.
 */
async function interceptOutboundFetches(body: () => Promise<unknown>): Promise<string[]> {
  const intercepted: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK_HOSTS.has(url.hostname)) return original(input, init)
    intercepted.push(url.href)
    return new Response("intercepted by test: no outbound request is made", { status: BLOCKED_STATUS })
  }) as typeof fetch
  try {
    await body()
  } finally {
    globalThis.fetch = original
  }
  return intercepted
}

describe("catch-all route", () => {
  test("answers an unknown GET locally and never contacts the third-party host", async () => {
    await using project = await tmpdir({ git: true })
    const outbound = await interceptOutboundFetches(async () => {
      const response = await server.fetch(`/no-such-route?directory=${encodeURIComponent(project.path)}`, {
        headers: { Authorization: AUTH },
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "Not Found" })
    })
    expect(outbound.filter((url) => url.includes(THIRD_PARTY_HOST))).toEqual([])
  })

  test("never forwards a credential-bearing POST with a body to the third-party host", async () => {
    await using project = await tmpdir({ git: true })
    const outbound = await interceptOutboundFetches(async () => {
      const response = await server.fetch(`/no-such-route?directory=${encodeURIComponent(project.path)}`, {
        method: "POST",
        headers: { Authorization: AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ secret: "do-not-forward" }),
      })
      expect(response.status).toBe(404)
    })
    expect(outbound.filter((url) => url.includes(THIRD_PARTY_HOST))).toEqual([])
  })
})
