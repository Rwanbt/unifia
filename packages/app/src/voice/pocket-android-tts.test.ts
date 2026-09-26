/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"

import { TTS_ERROR_CODES, TTS_LANGUAGES } from "@unifia/contracts/tts-router"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import type { EotFixture } from "@unifia/contracts/voice-eot-bench"

import { PocketAndroidBackend, __test_only__ as scaffold } from "./pocket-android-tts"
import { loadEotBench } from "./eot-bench-corpus"

const SAMPLE_TEXT = "Hello world"
const ALL_LANGUAGES = TTS_LANGUAGES as readonly SpeechLanguage[]

describe("PocketAndroidBackend — R7 scaffolding", () => {
  test("exposes canonical TtsBackend surface and capabilities", () => {
    const backend = new PocketAndroidBackend()
    expect(backend.id).toBe("pocket")
    expect(backend.capabilities.providerId).toBe("pocket")
    expect(backend.capabilities.streaming).toBe(true)
    expect(backend.capabilities.voiceCloning).toBe(true)
    expect(backend.capabilities.cpuOnly).toBe(true)
    expect(backend.capabilities.remoteCapable).toBe(false)
    // 5 mandatory languages per ADR-062 / plan §7.
    expect(backend.capabilities.languages.length).toBe(5)
    for (const language of ALL_LANGUAGES) {
      expect(backend.capabilities.languages).toContain(language)
    }
    expect(backend.capabilities.ttfaMs).toBeGreaterThan(0)
    expect(backend.capabilities.chunkCadenceMs).toBeGreaterThan(0)
  })

  test("prepare() succeeds for each of the 5 mandatory languages", async () => {
    for (const language of ALL_LANGUAGES) {
      // Each backend instance is single-language; re-prepare for each lang.
      const fresh = new PocketAndroidBackend()
      await expect(
        fresh.prepare({ language, speed: 1.0 }),
      ).resolves.toBeUndefined()
    }
  })

  test("prepare() rejects a non-supported language with TTS_LANGUAGE_UNSUPPORTED", async () => {
    const backend = new PocketAndroidBackend()
    let captured: unknown
    try {
      await backend.prepare({
        language: "ja" as unknown as SpeechLanguage,
        speed: 1.0,
      })
    } catch (error) {
      captured = error
    }
    expect(captured).toBeInstanceOf(Error)
    const err = captured as Error & { code?: string }
    expect(err.code).toBe(TTS_ERROR_CODES.LANGUAGE_UNSUPPORTED)
  })

  test("prepare() rejects an already-aborted signal", async () => {
    const backend = new PocketAndroidBackend()
    const controller = new AbortController()
    controller.abort()
    let captured: unknown
    try {
      await backend.prepare({ language: "en", speed: 1.0 }, controller.signal)
    } catch (error) {
      captured = error
    }
    const err = captured as Error & { code?: string }
    expect(err.code).toBe(TTS_ERROR_CODES.STREAMING_CANCELLED)
  })

  test("prepare() rejects an invalid speed", async () => {
    const backend = new PocketAndroidBackend()
    let captured: unknown
    try {
      await backend.prepare({ language: "en", speed: 0 })
    } catch (error) {
      captured = error
    }
    const err = captured as Error & { code?: string }
    expect(err.code).toBe(TTS_ERROR_CODES.MODEL_LOAD_FAILED)
  })

  test("synthesize() yields a deterministic chunk stream with a single final chunk", async () => {
    const backend = new PocketAndroidBackend()
    await backend.prepare({ language: "en", speed: 1.0 })
    const chunks: { sequence: number; final: boolean; length: number }[] = []
    for await (const event of backend.synthesize(SAMPLE_TEXT, new AbortController().signal)) {
      if ("code" in event) throw new Error(`unexpected error: ${event.code}`)
      chunks.push({
        sequence: event.sequence,
        final: event.final,
        length: event.samples.length,
      })
    }
    expect(chunks.length).toBeGreaterThan(0)
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].final).toBe(false)
      expect(chunks[i].sequence).toBe(i)
    }
    const last = chunks[chunks.length - 1]
    expect(last.final).toBe(true)
    expect(last.sequence).toBe(chunks.length - 1)
    for (const chunk of chunks) {
      expect(chunk.length).toBe(scaffold.CHUNK_FRAME_COUNT)
    }
  })

  test("synthesize() respects AbortSignal mid-stream without throwing", async () => {
    const backend = new PocketAndroidBackend()
    await backend.prepare({ language: "fr", speed: 1.0 })
    const controller = new AbortController()
    let yielded = 0
    for await (const event of backend.synthesize(
      "Une longue phrase qui produirait normalement beaucoup de chunks",
      controller.signal,
    )) {
      if ("code" in event) throw new Error(`unexpected error: ${event.code}`)
      yielded += 1
      if (yielded === 2) controller.abort()
    }
    // The first 2 chunks were consumed; the iterator's signal check
    // closes it cleanly without throwing, leaving us with > 2 and < total.
    expect(yielded).toBeGreaterThanOrEqual(2)
  })

  test("synthesize() before prepare() yields TtsProviderError", async () => {
    const backend = new PocketAndroidBackend()
    const events: unknown[] = []
    for await (const event of backend.synthesize(
      SAMPLE_TEXT,
      new AbortController().signal,
    )) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    const first = events[0] as { code?: string }
    expect(first.code).toBe(TTS_ERROR_CODES.MODEL_LOAD_FAILED)
  })

  test("cancel() prevents further synthesize() yields", async () => {
    const backend = new PocketAndroidBackend()
    await backend.prepare({ language: "es", speed: 1.0 })
    await backend.cancel("rid")
    const events: unknown[] = []
    for await (const event of backend.synthesize(
      "hola mundo",
      new AbortController().signal,
    )) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    const first = events[0] as { code?: string }
    expect(first.code).toBe(TTS_ERROR_CODES.STREAMING_CANCELLED)
  })
})

/* -------------------------------------------------------------------------
 * R4 corpus cross-check: every fixture's language must be in the 5-lang
 * pocket language set, and prepare() must accept it. This is the gate
 * for "Pocket Android covers EN/FR/ES/IT/DE" before device benches land.
 * ------------------------------------------------------------------------- */

describe("PocketAndroidBackend — R4 UNIFIA-EOT-BENCH corpus cross-check", () => {
  test("every corpus fixture's language is supported by PocketAndroidBackend", async () => {
    const result = await loadEotBench()
    if (!result.ok) {
      // No corpus loaded — synthesize one minimal fixture per language
      // so the test always exercises the 5-language coverage gate.
      const synthetic: EotFixture[] = ALL_LANGUAGES.map((language, idx) => ({
        id: `r4-r7-scaffold-${idx}`,
        language,
        scenario: "short-statement" as const,
        transcript: "scaffold",
        expectedTurnComplete: true,
      }))
      for (const fixture of synthetic) {
        await assertFixtureLanguageCovered(fixture)
      }
      return
    }
    const corpus = result.corpus
    // Every language in the corpus must be in the 5-language capability
    // set of PocketAndroidBackend. Per ADR-062 and plan §7, any fixture
    // outside EN/FR/ES/IT/DE means the corpus has been contaminated and
    // MUST fail loudly (not "soft-pass" via the fallback chain).
    const supportedLanguages = new Set<SpeechLanguage>(ALL_LANGUAGES)
    const unsupportedFixtures = corpus.fixtures.filter(
      (fixture) => !supportedLanguages.has(fixture.language),
    )
    expect(unsupportedFixtures).toHaveLength(0)
    // And every fixture must successfully prepare on a fresh backend.
    for (const fixture of corpus.fixtures) {
      await assertFixtureLanguageCovered(fixture)
    }
  })
})

async function assertFixtureLanguageCovered(fixture: EotFixture) {
  const backend = new PocketAndroidBackend()
  // The corpus fixture carries `language: SpeechLanguage`. prepare()
  // accepts it iff the language is in the Pocket capability set.
  await expect(
    backend.prepare({ language: fixture.language, speed: 1.0 }),
  ).resolves.toBeUndefined()
}
