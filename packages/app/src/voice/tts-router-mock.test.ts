/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  createMockTtsBackend,
  createMockTtsRouter,
  type MockTtsBackendScript,
} from "./tts-router-mock"
import { TTS_DEFAULT_FALLBACK_ORDER, type TtsProviderId } from "@unifia/contracts/tts-router"

const SAMPLE_CHUNKS = (count: number, finalAt?: number) =>
  Array.from({ length: count }, (_, i) => ({
    samples: new Int16Array(160),
    sampleRateHz: 22050,
    final: finalAt === i,
  }))

function pocketScript(chunks: number, error?: { code: string; detail: string; recoverable: boolean }): MockTtsBackendScript {
  const base = SAMPLE_CHUNKS(chunks, chunks - 1)
  return {
    id: "pocket",
    languages: ["en", "fr", "es", "it", "de"],
    perLanguage: {
      en: { chunks: base, error },
      fr: { chunks: base },
      es: { chunks: base },
      it: { chunks: base },
      de: { chunks: base },
    },
  }
}

function piperScript(chunks: number, failPrepare: string[] = []): MockTtsBackendScript {
  const perLanguage: MockTtsBackendScript["perLanguage"] = {
    en: { chunks: SAMPLE_CHUNKS(chunks, chunks - 1) },
    fr: { chunks: SAMPLE_CHUNKS(chunks, chunks - 1) },
    es: { chunks: SAMPLE_CHUNKS(chunks, chunks - 1) },
    it: { chunks: SAMPLE_CHUNKS(chunks, chunks - 1) },
    de: { chunks: SAMPLE_CHUNKS(chunks, chunks - 1) },
  }
  for (const lang of failPrepare) {
    perLanguage[lang as "en"] = {
      chunks: SAMPLE_CHUNKS(chunks, chunks - 1),
      prepareFailsWith: { code: "TTS_MODEL_LOAD_FAILED", detail: `Piper unavailable for ${lang}` },
    }
  }
  return { id: "piper", languages: ["en", "fr", "es", "it", "de"], perLanguage }
}

function fallbackScript(): MockTtsBackendScript {
  return {
    id: "fallback-android-tts",
    languages: ["en", "fr", "es", "it", "de"],
    perLanguage: {
      en: { chunks: SAMPLE_CHUNKS(2, 1) },
      fr: { chunks: SAMPLE_CHUNKS(2, 1) },
      es: { chunks: SAMPLE_CHUNKS(2, 1) },
      it: { chunks: SAMPLE_CHUNKS(2, 1) },
      de: { chunks: SAMPLE_CHUNKS(2, 1) },
    },
  }
}

describe("MockTtsRouter — R8 fallback chain", () => {
  test("primary Pocket serves all 5 languages", async () => {
    const router = createMockTtsRouter([
      createMockTtsBackend(pocketScript(4)),
      createMockTtsBackend(fallbackScript()),
    ])
    for (const language of ["en", "fr", "es", "it", "de"] as const) {
      const providerId = await router.prepare(language)
      expect(providerId).toBe("pocket")
      const chunks: number[] = []
      for await (const event of router.synthesize(
        { id: "t1", text: "Hello", language, speed: 1.0 },
        new AbortController().signal,
      )) {
        if ("code" in event) throw new Error(`unexpected error: ${event.code}`)
        chunks.push(event.sequence)
      }
      expect(chunks.length).toBe(4)
    }
    await router.dispose()
  })

  test("falls back to Piper when Pocket prepare fails", async () => {
    const router = createMockTtsRouter([
      createMockTtsBackend({
        ...pocketScript(3),
        perLanguage: {
          en: { chunks: [], prepareFailsWith: { code: "TTS_MODEL_LOAD_FAILED", detail: "Pocket EN missing" } },
          fr: { chunks: SAMPLE_CHUNKS(3, 2) },
          es: { chunks: SAMPLE_CHUNKS(3, 2) },
          it: { chunks: SAMPLE_CHUNKS(3, 2) },
          de: { chunks: SAMPLE_CHUNKS(3, 2) },
        },
      }),
      createMockTtsBackend(piperScript(3)),
    ])
    expect(await router.prepare("en")).toBe("piper")
    expect(await router.prepare("fr")).toBe("pocket")
    await router.dispose()
  })

  test("falls back to fallback-android-tts when both Pocket and Piper fail", async () => {
    const router = createMockTtsRouter([
      createMockTtsBackend({
        ...pocketScript(3),
        perLanguage: {
          en: { chunks: [], prepareFailsWith: { code: "TTS_MODEL_LOAD_FAILED", detail: "Pocket down" } },
          fr: { chunks: [], prepareFailsWith: { code: "TTS_MODEL_LOAD_FAILED", detail: "Pocket down" } },
          es: { chunks: [], prepareFailsWith: { code: "TTS_MODEL_LOAD_FAILED", detail: "Pocket down" } },
          it: { chunks: [], prepareFailsWith: { code: "TTS_MODEL_LOAD_FAILED", detail: "Pocket down" } },
          de: { chunks: [], prepareFailsWith: { code: "TTS_MODEL_LOAD_FAILED", detail: "Pocket down" } },
        },
      }),
      createMockTtsBackend({
        ...piperScript(3, ["en", "fr", "es", "it", "de"]),
      }),
      createMockTtsBackend(fallbackScript()),
    ])
    expect(await router.prepare("en")).toBe("fallback-android-tts")
    await router.dispose()
  })

  test("non-recoverable mid-stream error aborts the synthesis", async () => {
    const router = createMockTtsRouter([
      createMockTtsBackend({
        ...pocketScript(2),
        perLanguage: {
          en: {
            chunks: SAMPLE_CHUNKS(2, 1),
            error: { code: "TTS_CONTENT_POLICY_BLOCKED", detail: "secret detected", recoverable: false },
          },
          fr: { chunks: SAMPLE_CHUNKS(2, 1) },
          es: { chunks: SAMPLE_CHUNKS(2, 1) },
          it: { chunks: SAMPLE_CHUNKS(2, 1) },
          de: { chunks: SAMPLE_CHUNKS(2, 1) },
        },
      }),
      createMockTtsBackend(piperScript(2)),
    ])
    const events: string[] = []
    for await (const event of router.synthesize(
      { id: "t1", text: "secret", language: "en", speed: 1.0 },
      new AbortController().signal,
    )) {
      if ("code" in event) events.push(`error:${event.code}`)
      else events.push(`chunk:${event.sequence}`)
    }
    expect(events[0]).toBe("error:TTS_CONTENT_POLICY_BLOCKED")
    expect(events.length).toBe(1)
  })

  test("recoverable mid-stream error falls back to next provider", async () => {
    const router = createMockTtsRouter([
      createMockTtsBackend({
        ...pocketScript(2),
        perLanguage: {
          en: {
            chunks: SAMPLE_CHUNKS(2, 1),
            error: { code: "TTS_MODEL_INTEGRITY_FAILED", detail: "checksum mismatch", recoverable: true },
          },
          fr: { chunks: SAMPLE_CHUNKS(2, 1) },
          es: { chunks: SAMPLE_CHUNKS(2, 1) },
          it: { chunks: SAMPLE_CHUNKS(2, 1) },
          de: { chunks: SAMPLE_CHUNKS(2, 1) },
        },
      }),
      createMockTtsBackend(piperScript(3)),
    ])
    const events: string[] = []
    for await (const event of router.synthesize(
      { id: "t1", text: "hello", language: "en", speed: 1.0 },
      new AbortController().signal,
    )) {
      if ("code" in event) events.push(`error:${event.code}`)
      else events.push(`chunk:${event.sequence}`)
    }
    // First a recoverable error from Pocket, then Piper picks up with chunks.
    expect(events[0]).toBe("error:TTS_MODEL_INTEGRITY_FAILED")
    expect(events.length).toBeGreaterThan(1)
    expect(events.filter((e) => e.startsWith("chunk:")).length).toBe(3)
  })

  test("language outside all backend capabilities raises an explicit error", async () => {
    const router = createMockTtsRouter([
      createMockTtsBackend({
        id: "pocket",
        languages: ["en"],
        perLanguage: { en: { chunks: SAMPLE_CHUNKS(1, 0) }, fr: { chunks: [] }, es: { chunks: [] }, it: { chunks: [] }, de: { chunks: [] } },
      }),
    ])
    await expect(router.prepare("fr")).rejects.toThrow(/no backend covers/i)
  })

  test("cancel dispatches to every backend", async () => {
    const backends: MockTtsBackendScript[] = (["pocket", "piper", "fallback-android-tts"] as TtsProviderId[]).map((id) => ({
      id,
      languages: ["en", "fr", "es", "it", "de"],
      perLanguage: {
        en: { chunks: SAMPLE_CHUNKS(1, 0) },
        fr: { chunks: SAMPLE_CHUNKS(1, 0) },
        es: { chunks: SAMPLE_CHUNKS(1, 0) },
        it: { chunks: SAMPLE_CHUNKS(1, 0) },
        de: { chunks: SAMPLE_CHUNKS(1, 0) },
      },
    }))
    const router = createMockTtsRouter(backends.map((b) => createMockTtsBackend(b)))
    await router.cancel("req-1")
    await router.dispose()
    expect(TTS_DEFAULT_FALLBACK_ORDER).toContain("pocket")
    expect(TTS_DEFAULT_FALLBACK_ORDER).toContain("piper")
  })
})
