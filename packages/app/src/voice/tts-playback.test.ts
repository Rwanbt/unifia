/* SPDX-License-Identifier: MIT */
import { describe, expect, it } from "bun:test"
import { TTS_ERROR_CODES, type TtsBackend, type TtsAudioChunk } from "@unifia/contracts/tts-router"
import { AudioPlaybackCoordinator } from "./audio-playback-coordinator"
import { createTtsRouter } from "./tts-router"
import { playTtsRequest } from "./tts-playback"

function backend(
  id: "pocket" | "fallback-android-tts",
  events: readonly (TtsAudioChunk | { code: string; detail: string; recoverable: boolean; capturedAt: number })[],
  cancelCalls: string[] = [],
): TtsBackend {
  return {
    id,
    capabilities: {
      providerId: id,
      languages: ["en", "fr", "es", "it", "de"],
      productionReady: true,
      streaming: true,
      voiceCloning: false,
      cpuOnly: true,
      remoteCapable: false,
      ttfaMs: 10,
      chunkCadenceMs: 10,
    },
    async prepare() {},
    async *synthesize(_text, signal) {
      for (const event of events) {
        if (signal.aborted) return
        yield event
      }
    },
    async cancel(requestId) {
      cancelCalls.push(`${id}:${requestId}`)
    },
    async dispose() {},
  }
}

function chunk(sequence: number): TtsAudioChunk {
  return { samples: new Int16Array([sequence]), sampleRateHz: 22050, generatedAt: sequence, sequence, final: true }
}

const request = { id: "play-1", text: "hello", language: "en" as const, speed: 1 }

describe("playTtsRequest arbitration (G8)", () => {
  it("rejects autoplay while manual owns the playback lease", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const router = createTtsRouter([backend("pocket", [chunk(0)])])
    const manual = coordinator.acquire("manual", () => {})
    expect(manual).toBeDefined()
    const consumed: number[] = []
    const played = await playTtsRequest({ router, coordinator, consume: async (audio) => { consumed.push(audio.sequence) } }, request, "autoplay")
    expect(played).toBe(false)
    expect(consumed).toEqual([])
    coordinator.release(manual!)
  })

  it("preview requests share manual priority and preempt autoplay", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const router = createTtsRouter([backend("pocket", [chunk(0)])])
    const autoplay = coordinator.acquire("autoplay", () => {})
    expect(autoplay).toBeDefined()
    const consumed: number[] = []
    const played = await playTtsRequest(
      { router, coordinator, consume: async (audio) => { consumed.push(audio.sequence) } },
      request,
      "preview",
    )
    expect(played).toBe(true)
    expect(consumed).toEqual([0])
    expect(coordinator.isCurrent(autoplay!)).toBe(false)
  })

  it("Live preempts manual and aborts the manual PCM consumer", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const cancelCalls: string[] = []
    const router = createTtsRouter([backend("pocket", [chunk(0), chunk(1)], cancelCalls)])
    const consumed: number[] = []
    const manual = playTtsRequest({
      router,
      coordinator,
      consume: async (audio, signal) => {
        consumed.push(audio.sequence)
        if (audio.sequence === 0) {
          const liveLease = coordinator.acquire("live", () => {})
          expect(liveLease).toBeDefined()
        }
        if (signal.aborted) throw new Error("manual consumer aborted")
      },
    }, request, "manual")
    await expect(manual).resolves.toBe(false)
    expect(consumed).toEqual([0])
    expect(cancelCalls).toEqual(["pocket:play-1"])
  })

  it("routes local fallback chunks and reports recoverable provider errors", async () => {
    const router = createTtsRouter([
      backend("pocket", [{
        code: TTS_ERROR_CODES.MODEL_INTEGRITY_FAILED,
        detail: "local Pocket weights failed integrity validation",
        recoverable: true,
        capturedAt: 1,
      }]),
      backend("fallback-android-tts", [chunk(7)]),
    ])
    const coordinator = new AudioPlaybackCoordinator()
    const errors: string[] = []
    const samples: number[] = []
    const played = await playTtsRequest({
      router,
      coordinator,
      consume: async (audio) => { samples.push(audio.samples[0]!) },
      onProviderError: (error) => errors.push(error.code),
    }, request, "live")
    expect(played).toBe(true)
    expect(errors).toEqual([TTS_ERROR_CODES.MODEL_INTEGRITY_FAILED])
    expect(samples).toEqual([7])
  })

  it("surfaces explicit failure when no approved local provider is ready", async () => {
    const router = createTtsRouter([
      backend("pocket", [{
        code: TTS_ERROR_CODES.MODEL_LOAD_FAILED,
        detail: "local model absent",
        recoverable: true,
        capturedAt: 1,
      }]),
    ])
    const coordinator = new AudioPlaybackCoordinator()
    const errors: string[] = []
    const played = playTtsRequest({
      router,
      coordinator,
      consume: async () => {},
      onProviderError: (error) => errors.push(error.code),
    }, request, "manual")
    await expect(played).rejects.toMatchObject({ code: TTS_ERROR_CODES.PROVIDER_OFFLINE })
    expect(errors).toEqual([TTS_ERROR_CODES.MODEL_LOAD_FAILED, TTS_ERROR_CODES.PROVIDER_OFFLINE])
  })

  it("does not fall back to remote-capable speech without explicit policy", async () => {
    const remote: TtsBackend = {
      ...backend("pocket", [chunk(0)]),
      capabilities: {
        ...backend("pocket", [chunk(0)]).capabilities,
        remoteCapable: true,
      },
    }
    const router = createTtsRouter([remote])
    const coordinator = new AudioPlaybackCoordinator()
    const errors: string[] = []
    const samples: number[] = []
    const played = playTtsRequest({
      router,
      coordinator,
      consume: async (audio) => { samples.push(audio.sequence) },
      onProviderError: (error) => errors.push(error.code),
    }, request, "autoplay")
    await expect(played).rejects.toMatchObject({ code: TTS_ERROR_CODES.PROVIDER_OFFLINE })
    expect(samples).toEqual([])
    expect(errors).toEqual([TTS_ERROR_CODES.PROVIDER_OFFLINE])
  })
})
