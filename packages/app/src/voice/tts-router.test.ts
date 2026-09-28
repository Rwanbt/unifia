/* SPDX-License-Identifier: MIT */
import { describe, expect, it } from "bun:test"
import {
  TTS_ERROR_CODES,
  type TtsAudioChunk,
  type TtsBackend,
  type TtsConfig,
  type TtsProviderError,
  type TtsProviderId,
} from "@unifia/contracts/tts-router"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import { createTtsRouter } from "./tts-router"
import { createVoiceResourceScheduler } from "./resource-scheduler"
import { activeLeases, wireTtsLease } from "./wired-providers"

type BackendOptions = {
  readonly id: TtsProviderId
  readonly languages?: readonly SpeechLanguage[]
  readonly productionReady?: boolean
  readonly remoteCapable?: boolean
  readonly prepareError?: TtsProviderError
  readonly events?: readonly (TtsAudioChunk | TtsProviderError)[]
  readonly prepareCalls?: string[]
  readonly synthCalls?: string[]
}

function backend(options: BackendOptions): TtsBackend {
  return {
    id: options.id,
    capabilities: {
      providerId: options.id,
      languages: options.languages ?? ["en", "fr", "es", "it", "de"],
      productionReady: options.productionReady,
      streaming: true,
      voiceCloning: false,
      cpuOnly: true,
      remoteCapable: options.remoteCapable ?? false,
      ttfaMs: 50,
      chunkCadenceMs: 20,
    },
    async prepare(config: TtsConfig): Promise<void> {
      options.prepareCalls?.push(`${options.id}:${config.language}:${config.speed}`)
      if (options.prepareError) throw Object.assign(new Error(options.prepareError.detail), options.prepareError)
    },
    async *synthesize(text: string, signal: AbortSignal) {
      options.synthCalls?.push(`${options.id}:${text}`)
      for (const event of options.events ?? []) {
        if (signal.aborted) return
        yield event
      }
    },
    async cancel() {},
    async dispose() {},
  }
}

function chunk(sequence: number, final: boolean): TtsAudioChunk {
  return { samples: new Int16Array([sequence]), sampleRateHz: 22050, generatedAt: sequence, sequence, final }
}

const request = { id: "req-1", text: "bonjour", language: "fr" as const, speed: 1.2 }

describe("production TtsRouter (G8)", () => {
  it("uses the first production-ready provider that prepares for the language", async () => {
    const calls: string[] = []
    const router = createTtsRouter([
      backend({ id: "pocket", productionReady: false, prepareCalls: calls }),
      backend({ id: "piper", prepareCalls: calls }),
    ])
    expect(await router.prepare("fr")).toBe("piper")
    expect(calls).toEqual(["piper:fr:1"])
  })

  it("skips remote-capable backends unless explicitly allowed", async () => {
    const piper = backend({ id: "piper", remoteCapable: true })
    const local = backend({ id: "fallback-android-tts" })
    const localOnly = createTtsRouter([piper, local])
    expect(await localOnly.prepare("en")).toBe("fallback-android-tts")

    const explicit = createTtsRouter([piper, local], { allowRemoteProviders: ["piper"] })
    expect(await explicit.prepare("en")).toBe("piper")
  })

  it("skips a backend that is not production-ready", async () => {
    const router = createTtsRouter([backend({ id: "pocket", productionReady: false })])
    await expect(router.prepare("en")).rejects.toMatchObject({ code: TTS_ERROR_CODES.PROVIDER_OFFLINE })
    const events = []
    for await (const event of router.synthesize(request, new AbortController().signal)) events.push(event)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ code: TTS_ERROR_CODES.PROVIDER_OFFLINE, recoverable: false })
  })

  it("falls back after a recoverable provider-load failure and preserves diagnostics", async () => {
    const primaryError: TtsProviderError = {
      code: TTS_ERROR_CODES.MODEL_INTEGRITY_FAILED,
      detail: "pinned weights failed verification",
      recoverable: true,
      capturedAt: 10,
    }
    const fallbackCalls: string[] = []
    const router = createTtsRouter([
      backend({ id: "pocket", prepareError: primaryError }),
      backend({ id: "fallback-android-tts", events: [chunk(0, true)], synthCalls: fallbackCalls }),
    ])
    const events = []
    for await (const event of router.synthesize(request, new AbortController().signal)) events.push(event)
    expect(events[0]).toMatchObject({ code: TTS_ERROR_CODES.MODEL_INTEGRITY_FAILED, recoverable: true })
    expect(events[1]).toMatchObject({ sequence: 0, final: true })
    expect(fallbackCalls).toEqual(["fallback-android-tts:bonjour"])
  })

  it("never restarts an utterance after audio has started", async () => {
    const fallbackCalls: string[] = []
    const router = createTtsRouter([
      backend({
        id: "pocket",
        events: [
          chunk(0, false),
          { code: TTS_ERROR_CODES.PROVIDER_OFFLINE, detail: "provider disconnected", recoverable: true, capturedAt: 2 },
        ],
      }),
      backend({ id: "fallback-android-tts", events: [chunk(0, true)], synthCalls: fallbackCalls }),
    ])
    const events = []
    for await (const event of router.synthesize(request, new AbortController().signal)) events.push(event)
    expect(events).toHaveLength(2)
    expect("samples" in events[0]).toBe(true)
    expect("code" in events[1]).toBe(true)
    expect(fallbackCalls).toHaveLength(0)
  })

  it("content-policy errors cannot be made recoverable by a backend", async () => {
    const fallbackCalls: string[] = []
    const router = createTtsRouter([
      backend({ id: "pocket", events: [{
        code: TTS_ERROR_CODES.CONTENT_POLICY_BLOCKED,
        detail: "speech content is blocked",
        // A buggy or compromised provider cannot override the
        // router's canonical non-recoverable policy classification.
        recoverable: true,
        capturedAt: 1,
      }] }),
      backend({ id: "fallback-android-tts", events: [chunk(0, true)], synthCalls: fallbackCalls }),
    ])
    const events = []
    for await (const event of router.synthesize(request, new AbortController().signal)) events.push(event)
    expect(events).toEqual([
      expect.objectContaining({ code: TTS_ERROR_CODES.CONTENT_POLICY_BLOCKED, recoverable: false }),
    ])
    expect(fallbackCalls).toEqual([])
  })

  it("does not replay a partial stream that ended without a final chunk", async () => {
    const fallbackCalls: string[] = []
    const router = createTtsRouter([
      backend({ id: "pocket", events: [chunk(0, false)] }),
      backend({ id: "fallback-android-tts", events: [chunk(0, true)], synthCalls: fallbackCalls }),
    ])
    const events = []
    for await (const event of router.synthesize(request, new AbortController().signal)) events.push(event)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ code: TTS_ERROR_CODES.MODEL_LOAD_FAILED, recoverable: false })
    expect(fallbackCalls).toHaveLength(0)
  })

  it("no ready local provider produces an explicit non-recoverable error", async () => {
    const router = createTtsRouter([backend({ id: "pocket", productionReady: false })])
    const events = []
    for await (const event of router.synthesize(request, new AbortController().signal)) events.push(event)
    expect(events).toEqual([
      expect.objectContaining({ code: TTS_ERROR_CODES.PROVIDER_OFFLINE, recoverable: false }),
    ])
  })

  it("cancellation stops synthesis without converting abort into provider fallback", async () => {
    const router = createTtsRouter([
      backend({
        id: "pocket",
        events: [chunk(0, false), chunk(1, true)],
      }),
      backend({ id: "fallback-android-tts", events: [chunk(0, true)] }),
    ])
    const controller = new AbortController()
    const events = []
    for await (const event of router.synthesize(request, controller.signal)) {
      events.push(event)
      controller.abort()
    }
    expect(events).toHaveLength(1)
    expect("samples" in events[0]).toBe(true)
  })

  it("TTS backend lease is acquired at registration and released on disposal", async () => {
    const scheduler = createVoiceResourceScheduler({ mode: "mobile" })
    const base = backend({ id: "pocket", events: [chunk(0, true)] })
    const wired = wireTtsLease(
      scheduler,
      base,
      {
        resource: { kind: "tts", language: "fr", revision: "test" },
        owner: "pocket-tts",
        priority: "active-stt-tts",
        residency: "idle-evict",
      },
      { priority: "active-stt-tts", residency: "idle-evict" },
    )
    expect(activeLeases(scheduler, "pocket-tts")).toBe(1)
    await wired.base.prepare({ language: "fr", speed: 1 })
    await wired.base.dispose()
    expect(activeLeases(scheduler, "pocket-tts")).toBe(0)
  })
})
