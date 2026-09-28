/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Hono } from "hono"
import { LIVE_AGENT_NAME, mintLiveKitToken, readVoiceHostState, VoiceLiveRoutes, type VoiceHostState } from "../../src/server/routes/voice-live"

const HOST: VoiceHostState = {
  url: "ws://127.0.0.1:7880",
  lanUrl: "ws://192.168.1.20:7880",
  apiKey: "APIunifiatest",
  apiSecret: "s".repeat(48),
}

function app(options: { host?: VoiceHostState | undefined; role?: string; now?: () => number } = {}) {
  const root = new Hono()
  if (options.role) root.use((c, next) => {
    c.set("user" as never, { role: options.role } as never)
    return next()
  })
  root.route("/voice/live", VoiceLiveRoutes({ readHost: async () => ("host" in options ? options.host : HOST), now: options.now }))
  return root
}

function post(target: Hono, url: string, body: unknown, host = "127.0.0.1:4096") {
  return target.request(url, { method: "POST", headers: { "content-type": "application/json", host }, body: JSON.stringify(body) })
}

function decode(token: string) {
  const [header, body, signature] = token.split(".")
  const expected = createHmac("sha256", HOST.apiSecret).update(`${header}.${body}`).digest("base64url")
  return { valid: expected === signature, claims: JSON.parse(Buffer.from(body, "base64url").toString()) }
}

describe("Live voice routes", () => {
  test("issues a minimal, short-lived room token without exposing the secret", async () => {
    const target = app()
    const response = await post(target, "/voice/live/session", { directory: "/work/project", sessionID: "ses_abc", model: { providerID: "local-llm", modelID: "qwen" } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain(HOST.apiSecret)
    expect(body.url).toBe(HOST.url)
    const { valid, claims } = decode(body.token)
    expect(valid).toBe(true)
    expect(claims.iss).toBe(HOST.apiKey)
    expect(claims.exp - claims.nbf).toBeLessThanOrEqual(10 * 60 + 5)
    expect(claims.video).toMatchObject({ room: body.room, roomJoin: true, canPublishData: false, canPublishSources: ["microphone"] })
    expect(claims.video.roomAdmin).toBeUndefined()
    expect(claims.roomConfig.agents).toEqual([{ agentName: LIVE_AGENT_NAME, metadata: JSON.stringify({ binding: body.binding }) }])
    expect(claims.roomConfig.maxParticipants).toBe(2)
  })

  test("room names and identities are opaque", async () => {
    const response = await post(app(), "/voice/live/session", { directory: "/home/alice/secret-project", sessionID: "ses_abc" })
    const body = await response.json()
    const { claims } = decode(body.token)
    for (const value of [body.room, claims.sub, body.binding]) {
      expect(value).not.toContain("alice")
      expect(value).not.toContain("secret-project")
      expect(value).not.toContain("ses_abc")
    }
    expect(body.room).toMatch(/^unifia-live-[A-Za-z0-9]{24}$/)
  })

  test("the agent resolves the binding and records the session a first voice turn created", async () => {
    const target = app()
    const created = await (await post(target, "/voice/live/session", { directory: "/work/project", agent: "build" })).json()
    const binding = await (await target.request(`/voice/live/bindings/${created.binding}`)).json()
    expect(binding).toMatchObject({ directory: "/work/project", agent: "build", room: created.room })
    expect(binding.sessionID).toBeUndefined()
    expect((await post(target, `/voice/live/bindings/${created.binding}/session`, { sessionID: "ses_new" })).status).toBe(200)
    expect((await post(target, `/voice/live/bindings/${created.binding}/session`, { sessionID: "ses_other" })).status).toBe(409)
    // Reconnect: same room, same device identity, same session.
    const again = await (await post(target, "/voice/live/session", { binding: created.binding })).json()
    expect(again.room).toBe(created.room)
    expect(again.sessionID).toBe("ses_new")
    expect(decode(again.token).claims.sub).toBe(decode(created.token).claims.sub)
  })

  test("unknown or expired bindings are refused", async () => {
    let clock = 1_000_000
    const target = app({ now: () => clock })
    const created = await (await post(target, "/voice/live/session", { directory: "/work/project" })).json()
    clock += 13 * 60 * 60 * 1000
    expect((await target.request(`/voice/live/bindings/${created.binding}`)).status).toBe(404)
    expect((await post(target, "/voice/live/session", { binding: created.binding })).status).toBe(410)
  })

  test("LAN clients get the LAN URL only when LAN access is enabled", async () => {
    const lan = await (await post(app(), "/voice/live/session", { directory: "/w" }, "192.168.1.20:4096")).json()
    expect(lan.url).toBe(HOST.lanUrl)
    const localOnly = app({ host: { ...HOST, lanUrl: undefined } })
    const refused = await post(localOnly, "/voice/live/session", { directory: "/w" }, "192.168.1.20:4096")
    expect(refused.status).toBe(503)
    expect((await refused.json()).error).toBe("voice_host_lan_disabled")
  })

  test("reports an unavailable Voice Host", async () => {
    const target = app({ host: undefined })
    expect(await (await target.request("/voice/live/status")).json()).toEqual({ available: false, reason: "voice_host_unavailable" })
    expect((await post(target, "/voice/live/session", { directory: "/w" })).status).toBe(503)
  })

  test("validates input and refuses read-only accounts", async () => {
    expect((await post(app(), "/voice/live/session", { directory: "relative/path" })).status).toBe(400)
    expect((await post(app(), "/voice/live/session", { directory: "/w", extra: true })).status).toBe(400)
    expect((await post(app(), "/voice/live/session", { directory: "/w", sessionID: "not-a-session" })).status).toBe(400)
    expect((await post(app({ role: "viewer" }), "/voice/live/session", { directory: "/w" })).status).toBe(403)
  })

  test("rate limits token issuance", async () => {
    const target = app()
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) statuses.push((await post(target, "/voice/live/session", { directory: "/w" })).status)
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
  })

  test("reads the Voice Host state file and rejects incomplete ones", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "unifia-voice-host-"))
    try {
      expect(await readVoiceHostState(dir)).toBeUndefined()
      await writeFile(path.join(dir, "livekit.json"), JSON.stringify({ ...HOST, state: "starting" }))
      expect(await readVoiceHostState(dir)).toBeUndefined()
      await writeFile(path.join(dir, "livekit.json"), JSON.stringify({ ...HOST, state: "ready" }))
      expect(await readVoiceHostState(dir)).toEqual(HOST)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("token helper honours the requested lifetime", () => {
    const { expiresAt, token } = mintLiveKitToken({ apiKey: "k", apiSecret: HOST.apiSecret, identity: "d", room: "r", metadata: "{}", now: 0, ttlSeconds: 60 })
    expect(expiresAt).toBe(60_000)
    expect(decode(token).claims.exp).toBe(60)
  })
})
