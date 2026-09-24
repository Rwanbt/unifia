/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { VoiceTtsRoutes } from "../../src/server/routes/voice-tts"

const TOKEN = "a".repeat(64)
const WAV = new Uint8Array([82, 73, 70, 70, 87, 65, 86, 69])

function app(options: {
  role?: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: () => number
  nativeUrl?: string
} = {}) {
  const root = new Hono()
  if (options.role) root.use((c, next) => {
    c.set("user" as never, { role: options.role } as never)
    return next()
  })
  root.route("/voice/tts", VoiceTtsRoutes({
    nativeUrl: options.nativeUrl ?? "http://127.0.0.1:4242",
    nativeToken: TOKEN,
    fetch: options.fetch,
    now: options.now,
  }))
  return root
}

function post(target: Hono, path: string, body: unknown) {
  return target.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

const request = { text: "Bonjour", language: "fr", requestId: "tts_request_1" }

describe("Authenticated mobile manual TTS routes", () => {
  test("relays WAV bytes through the private loopback endpoint", async () => {
    let observed: Request | undefined
    const target = app({ fetch: async (input, init) => {
      observed = new Request(input, init)
      return new Response(WAV, { headers: { "content-type": "audio/wav" } })
    } })
    const response = await post(target, "/voice/tts", request)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("audio/wav")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WAV)
    expect(observed?.url).toBe("http://127.0.0.1:4242/tts/synthesize")
    expect(observed?.headers.get("x-keychain-token")).toBe(TOKEN)
    expect(await observed?.json()).toEqual(request)
  })

  test("refuses viewers, unknown fields, and non-loopback native endpoints", async () => {
    const target = app()
    expect((await post(app({ role: "viewer" }), "/voice/tts", request)).status).toBe(403)
    expect((await post(target, "/voice/tts", { ...request, path: "C:\\secret" })).status).toBe(400)
    expect((await post(app({ nativeUrl: "http://10.0.0.4:4242" }), "/voice/tts", request)).status).toBe(503)
  })

  test("cancels only through the private endpoint with the request identifier", async () => {
    let observed: Request | undefined
    const target = app({ fetch: async (input, init) => {
      observed = new Request(input, init)
      return new Response(null, { status: 204 })
    } })
    expect((await post(target, "/voice/tts/cancel", { requestId: request.requestId })).status).toBe(204)
    expect(observed?.url).toBe("http://127.0.0.1:4242/tts/cancel")
    expect(await observed?.json()).toEqual({ requestId: request.requestId })
  })

  test("limits expensive synthesis requests", async () => {
    let clock = 10_000
    const target = app({ now: () => clock, fetch: async () => new Response(WAV) })
    const statuses: number[] = []
    for (let index = 0; index < 31; index++) statuses.push((await post(target, "/voice/tts", request)).status)
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
    clock += 60_001
    expect((await post(target, "/voice/tts", request)).status).toBe(200)
  })
})
