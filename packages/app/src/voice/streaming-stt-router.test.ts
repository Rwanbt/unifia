/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import { createMockStreamingSttProvider } from "./streaming-stt-mock"
import { selectStreamingStt } from "./streaming-stt-router"
import { createFinalSttFallbackProvider, type FinalAudio } from "./streaming-stt-fallback"
import type { StreamingSttConfig, StreamingSttProvider } from "@unifia/contracts/streaming-stt"

function streaming(options: {
  languages?: readonly SpeechLanguage[]
  prepareError?: Error & { code?: string }
} = {}): StreamingSttProvider {
  const base = createMockStreamingSttProvider({
    id: "nemotron-streaming",
    languages: options.languages ?? ["en", "fr"],
    script: [],
  })
  if (!options.prepareError) return base
  return {
    ...base,
    prepare: () => Promise.reject(options.prepareError),
  }
}

function fallbackSpy() {
  const prepared: StreamingSttConfig[] = []
  const provider = createFinalSttFallbackProvider({
    transcribe: async (_audio: FinalAudio) => "final",
  })
  return {
    prepared,
    provider: {
      ...provider,
      prepare: async (config: StreamingSttConfig) => {
        prepared.push(config)
        return provider.prepare(config)
      },
    },
  }
}

describe("selectStreamingStt", () => {
  test("prefers a healthy streaming provider without a fallback marker", async () => {
    const probe = streaming()
    const spy = fallbackSpy()
    const choice = await selectStreamingStt({ language: "en", streaming: probe, fallback: spy.provider })
    expect(choice.providerId).toBe("nemotron-streaming")
    expect(choice.fallback).toBeUndefined()
    expect(spy.prepared).toHaveLength(0)
  })

  test("falls back when the language is not offered, recording the reason", async () => {
    const probe = streaming({ languages: ["en"] })
    const spy = fallbackSpy()
    const choice = await selectStreamingStt({ language: "de", streaming: probe, fallback: spy.provider })
    expect(choice.providerId).toBe("parakeet-tdt-final")
    expect(choice.fallback?.attempted).toBe("nemotron-streaming")
    expect(choice.fallback?.reason).toStartWith("STREAM_LANGUAGE_UNSUPPORTED")
    expect(spy.prepared).toEqual([{ language: "de" }])
  })

  test("falls back when prepare fails with a canonical code", async () => {
    const probe = streaming({
      prepareError: Object.assign(new Error("runtime not ready"), { code: "STREAM_PROVIDER_LOAD_FAILED" }),
    })
    const spy = fallbackSpy()
    const choice = await selectStreamingStt({ language: "en", streaming: probe, fallback: spy.provider })
    expect(choice.providerId).toBe("parakeet-tdt-final")
    expect(choice.fallback?.reason).toContain("prepare_failed:STREAM_PROVIDER_LOAD_FAILED")
    expect(choice.fallback?.reason).toContain("runtime not ready")
  })

  test("classifies untyped prepare failures as a provider load failure", async () => {
    const probe = streaming({ prepareError: new Error("kaboom") })
    const spy = fallbackSpy()
    const choice = await selectStreamingStt({ language: "en", streaming: probe, fallback: spy.provider })
    expect(choice.fallback?.reason).toStartWith("prepare_failed:STREAM_PROVIDER_LOAD_FAILED")
  })

  test("uses the honest fallback when no streaming provider is supplied", async () => {
    const spy = fallbackSpy()
    const choice = await selectStreamingStt({ language: "fr", fallback: spy.provider })
    expect(choice.providerId).toBe("parakeet-tdt-final")
    expect(choice.fallback?.attempted).toBeUndefined()
    expect(choice.fallback?.reason).toBe("streaming_provider_absent")
    expect(spy.prepared).toEqual([{ language: "fr" }])
  })

  test("propagates a fallback prepare failure instead of returning no provider", async () => {
    const spy = fallbackSpy()
    const broken = {
      ...spy.provider,
      prepare: () => Promise.reject(Object.assign(new Error("fallback broken"), { code: "STREAM_PROVIDER_LOAD_FAILED" })),
    }
    const err = await selectStreamingStt({ language: "en", fallback: broken }).catch(
      (error: unknown) => error,
    )
    expect((err as Error).message).toContain("fallback broken")
  })
})
