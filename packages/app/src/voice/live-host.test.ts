/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { DEFAULT_AUDIO_SETTINGS } from "./audio-settings"
import { createLiveHostClient, LiveHostError } from "./live-host"

function recorder(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe("Live host client", () => {
  test("requests a grant from the current server with its own credentials", async () => {
    const { calls, fetchImpl } = recorder(200, { url: "ws://127.0.0.1:7880", token: "t", expiresAt: 1, room: "r", binding: "lvb_x", sessionID: null })
    const client = createLiveHostClient({ platform: "mobile", server: () => ({ url: "http://192.168.1.20:4096/", authorization: "Basic abc" }), fetch: fetchImpl })
    const grant = await client.requestGrant({ directory: "/w" })
    expect(grant.binding).toBe("lvb_x")
    expect(calls[0].url).toBe("http://192.168.1.20:4096/voice/live/session")
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Basic abc")
  })

  test("maps server refusals to Live error codes", async () => {
    const cases: [number, unknown, string][] = [
      [503, { error: "voice_host_unavailable" }, "voice_host_unavailable"],
      [503, { error: "voice_host_lan_disabled" }, "voice_host_lan_disabled"],
      [410, { error: "binding_expired" }, "binding_invalid"],
      [429, { error: "rate_limited" }, "rate_limited"],
      [404, "Not Found", "voice_host_unavailable"],
    ]
    for (const [status, body, code] of cases) {
      const client = createLiveHostClient({ platform: "web", server: () => ({ url: "http://x" }), fetch: recorder(status, body).fetchImpl })
      const error = await client.requestGrant({ directory: "/w" }).catch((e) => e)
      expect(error).toBeInstanceOf(LiveHostError)
      expect(error.code).toBe(code)
    }
  })

  test("desktop starts the local Voice Host and frees it after the idle period", async () => {
    const invoked: string[] = []
    const client = createLiveHostClient({
      platform: "desktop",
      server: () => ({ url: "http://127.0.0.1:4096" }),
      fetch: recorder(200, true).fetchImpl,
      invoke: async (command, args) => {
        invoked.push(command === "voice_live_start" ? `${command}:${JSON.stringify(args)}` : command)
      },
      idleStopMs: 10,
    })
    await client.prepare({ ...DEFAULT_AUDIO_SETTINGS, voiceHostMode: "lan", cpuProfile: "eco" })
    expect(invoked[0]).toBe('voice_live_start:{"mode":"lan","cpuProfile":"eco","ttsProvider":"auto"}')
    await client.release("lvb_x")
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(invoked).toContain("voice_live_stop")
  })

  test("restarting Live before the idle period keeps the host", async () => {
    const invoked: string[] = []
    const client = createLiveHostClient({
      platform: "desktop",
      server: () => ({ url: "http://127.0.0.1:4096" }),
      fetch: recorder(200, true).fetchImpl,
      invoke: async (command) => void invoked.push(command),
      idleStopMs: 20,
    })
    await client.release("lvb_x")
    await client.prepare(DEFAULT_AUDIO_SETTINGS)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(invoked).not.toContain("voice_live_stop")
  })

  test("non-desktop runtimes never try to start a host", async () => {
    const client = createLiveHostClient({ platform: "mobile", server: () => ({ url: "http://x" }), invoke: async () => { throw new Error("no") } })
    await client.prepare(DEFAULT_AUDIO_SETTINGS)
  })

  test("mobile local mode reports that Live requires a connected desktop server", async () => {
    const client = createLiveHostClient({
      platform: "mobile",
      server: () => ({ url: "http://127.0.0.1:14096" }),
      fetch: recorder(200, true).fetchImpl,
    })
    const error = await client.prepare(DEFAULT_AUDIO_SETTINGS).catch((value) => value)
    expect(error).toBeInstanceOf(LiveHostError)
    expect(error.code).toBe("voice_host_unavailable")
  })
})
