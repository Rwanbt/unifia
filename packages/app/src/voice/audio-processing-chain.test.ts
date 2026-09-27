/* SPDX-License-Identifier: MIT */
import { describe, expect, it } from "bun:test"
import type { AudioRoute } from "@unifia/contracts/voice-turn-engine"
import { createVoiceResourceScheduler } from "./resource-scheduler"
import {
  createAudioProcessingChain,
  type AudioProcessingAdapter,
  type AudioProcessingCapability,
} from "./audio-processing-chain"

const FULL: AudioProcessingCapability = {
  supported: true,
  echoCancellation: true,
  noiseSuppression: true,
  automaticGainControl: true,
}

function adapter(
  id: "platform-aec" | "webrtc-apm",
  capability: (route: AudioRoute) => AudioProcessingCapability | Promise<AudioProcessingCapability>,
  hooks: { readonly start?: (route: AudioRoute) => void | Promise<void>; readonly stop?: () => void | Promise<void> } = {},
): AudioProcessingAdapter {
  return {
    id,
    async capability(route) { return capability(route) },
    async start(route) { await hooks.start?.(route) },
    async stop() { await hooks.stop?.() },
  }
}

describe("AudioProcessingChain G9 host capability policy", () => {
  it("selects platform AEC before software APM when all required capabilities exist", async () => {
    const starts: string[] = []
    const chain = createAudioProcessingChain([
      adapter("webrtc-apm", () => FULL, { start: () => { starts.push("software") } }),
      adapter("platform-aec", () => FULL, { start: () => { starts.push("platform") } }),
    ])
    const state = await chain.configure("speaker")
    expect(state).toMatchObject({ mode: "platform-aec", echoCancellation: true, noiseSuppression: true, automaticGainControl: true })
    expect(starts).toEqual(["platform"])
    await chain.dispose()
  })

  it("falls back to WebRTC APM when platform processing is unavailable on the route", async () => {
    const starts: string[] = []
    const chain = createAudioProcessingChain([
      adapter("platform-aec", () => ({ ...FULL, supported: false })),
      adapter("webrtc-apm", () => FULL, { start: () => { starts.push("software") } }),
    ])
    const state = await chain.configure("bluetooth-hfp")
    expect(state.mode).toBe("webrtc-apm")
    expect(state.route).toBe("bluetooth-hfp")
    expect(starts).toEqual(["software"])
    await chain.dispose()
  })

  it("requires the full AEC+NS+AGC chain and reports degraded mode if none qualifies", async () => {
    const chain = createAudioProcessingChain([
      adapter("platform-aec", () => ({ ...FULL, noiseSuppression: false })),
      adapter("webrtc-apm", () => ({ ...FULL, automaticGainControl: false })),
    ])
    const state = await chain.configure("speaker")
    expect(state).toEqual({
      mode: "degraded",
      route: "speaker",
      echoCancellation: false,
      noiseSuppression: false,
      automaticGainControl: false,
      failure: "capability-missing",
    })
    await chain.dispose()
  })

  it("tries the next adapter after native initialization fails and records the software provider", async () => {
    const starts: string[] = []
    const chain = createAudioProcessingChain([
      adapter("platform-aec", () => FULL, { start: () => { throw new Error("device effect failed") } }),
      adapter("webrtc-apm", () => FULL, { start: () => { starts.push("webrtc") } }),
    ])
    const state = await chain.configure("wired-headset")
    expect(state.mode).toBe("webrtc-apm")
    expect(starts).toEqual(["webrtc"])
    await chain.dispose()
  })

  it("releases the previous AEC lease and acquires a route-specific lease after route change", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const stopped: string[] = []
    const chain = createAudioProcessingChain(
      [adapter("platform-aec", () => FULL, { stop: () => { stopped.push("platform-stop") } })],
      { scheduler },
    )
    await chain.configure("speaker")
    const speaker = scheduler.find({ kind: "aec", revision: "platform-aec:speaker" })
    expect(speaker?.released).toBe(false)
    await chain.configure("wired-headset")
    expect(scheduler.find({ kind: "aec", revision: "platform-aec:speaker" })).toBeUndefined()
    expect(scheduler.find({ kind: "aec", revision: "platform-aec:wired-headset" })?.released).toBe(false)
    expect(stopped).toEqual(["platform-stop"])
    await chain.dispose()
    expect(scheduler.list()).toHaveLength(0)
  })

  it("releases processing resources on dispose and rejects later configure", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const chain = createAudioProcessingChain([adapter("webrtc-apm", () => FULL)], { scheduler })
    await chain.configure("speaker")
    expect(scheduler.list()).toHaveLength(1)
    await chain.dispose()
    expect(scheduler.list()).toHaveLength(0)
    await expect(chain.configure("speaker")).rejects.toThrow(/after dispose/)
  })
})
