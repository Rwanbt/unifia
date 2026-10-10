/* SPDX-License-Identifier: MIT */
/**
 * The catch-all for unknown routes must never send a request to a third-party host.
 *
 * An unknown route carries the caller's credentials and body. When the embedded interface
 * is absent, the catch-all used to forward the whole request to app.opencode.ai. These tests
 * record every outbound fetch while an unknown route is requested, and fail if one leaves
 * for that host.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"

const PASSWORD = "instance-fallback-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")
const THIRD_PARTY_HOST = "app.opencode.ai"

let server: InProcessServer

beforeAll(async () => {
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
})

/** Run `body` and return the URLs of every fetch it made. */
async function recordOutboundFetches(body: () => Promise<unknown>): Promise<string[]> {
  const urls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    urls.push(String(input instanceof Request ? input.url : input))
    return original(input, init)
  }) as typeof fetch
  try {
    await body()
  } finally {
    globalThis.fetch = original
  }
  return urls
}

describe("catch-all route", () => {
  test("answers an unknown GET locally and never contacts the third-party host", async () => {
    await using project = await tmpdir({ git: true })
    const urls = await recordOutboundFetches(async () => {
      const response = await server.fetch(`/no-such-route?directory=${encodeURIComponent(project.path)}`, {
        headers: { Authorization: AUTH },
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "Not Found" })
    })
    expect(urls.filter((url) => url.includes(THIRD_PARTY_HOST))).toEqual([])
  })

  test("never forwards a credential-bearing POST with a body to the third-party host", async () => {
    await using project = await tmpdir({ git: true })
    const urls = await recordOutboundFetches(async () => {
      const response = await server.fetch(`/no-such-route?directory=${encodeURIComponent(project.path)}`, {
        method: "POST",
        headers: { Authorization: AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ secret: "do-not-forward" }),
      })
      expect(response.status).toBe(404)
    })
    expect(urls.filter((url) => url.includes(THIRD_PARTY_HOST))).toEqual([])
  })
})
