/* SPDX-License-Identifier: MIT */
/* Gated end-to-end qualification against a LIVE nemo-speech server.

   Run from packages/app:
     G5_E2E_URL=http://127.0.0.1:8137 bun test ./src/voice/streaming-stt-nemo.e2e.test.ts

   The default happydom preload applies, but happy-dom's fetch enforces
   browser CORS against http://127.0.0.1 — so the test swaps in Bun's
   native fetch for the readiness probe and offline route-around (the
   exact network path a non-DOM runtime would take).

   Fixtures: one audioValid EN/FR/ES/IT/DE corpus utterance per nominal
   language (chosen because the recorded bake-off produced a correct
   non-empty final for each). Frames are paced at realtime so first-partial
   and final latencies stay honest. Results are written to
   .build-temp/g5-streaming/results/g5-e2e-provider.json even on failure. */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import type { PcmFrame } from "@unifia/contracts/streaming-stt"
import { nemoDeps } from "./nemo-transport"
import { createNemoStreamingSttProvider } from "./streaming-stt-nemo"

const E2E_URL = process.env.G5_E2E_URL
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")
const CORPUS_DIR = join(REPO_ROOT, "packages", "contracts", "corpus")
const RESULTS_PATH = join(REPO_ROOT, ".build-temp", "g5-streaming", "results", "g5-e2e-provider.json")
const FRAME_MS = 20
// Sanity bound, NOT the performance target (< 800 ms is tracked in the
// state file and not yet met: bake-off firstTextPartial mean 1242.8 ms,
// de language mean 2401 ms). This gate proves partials stream while
// audio is still playing — the absolute cap only catches pathology.
const FIRST_PARTIAL_BUDGET_MS = 2_500
const FINAL_BUDGET_MS = 1_000

interface FixtureSelection {
  id: string
  language: SpeechLanguage
}

const FIXTURES: readonly FixtureSelection[] = [
  { id: "en-short-01", language: "en" },
  { id: "fr-long-01", language: "fr" },
  { id: "es-long-01", language: "es" },
  { id: "it-short-01", language: "it" },
  { id: "de-filler-01", language: "de" },
]

interface FixtureResult {
  id: string
  language: string
  shaMatches: boolean
  audioDurationMs: number
  partialCount: number
  firstTextPartialMs: number | null
  finalLatencyMs: number | null
  finalText: string
  referenceWordsHit: number
  errorCodes: string[]
}

function readCorpusFixture(id: string): {
  transcript: string
  path: string
  sha256: string
  durationMs: number
} {
  const corpus = JSON.parse(readFileSync(join(CORPUS_DIR, "unifia-eot-bench.json"), "utf8")) as {
    fixtures: Array<{
      id: string
      transcript: string
      audio: { path: string; sha256: string; durationMs: number }
    }>
  }
  const fixture = corpus.fixtures.find((entry) => entry.id === id)
  if (!fixture) throw new Error(`corpus fixture ${id} not found`)
  return {
    transcript: fixture.transcript,
    path: fixture.audio.path,
    sha256: fixture.audio.sha256,
    durationMs: fixture.audio.durationMs,
  }
}

function readWavMonoPcm16(wavPath: string): { samples: Int16Array; sampleRateHz: number } {
  const buffer = readFileSync(wavPath)
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${wavPath}: not a RIFF/WAVE file`)
  }
  let offset = 12
  let sampleRateHz = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (chunkId === "fmt ") {
      if (buffer.readUInt16LE(offset + 8) !== 1 || buffer.readUInt16LE(offset + 10) !== 1) {
        throw new Error(`${wavPath}: expected mono PCM16`)
      }
      sampleRateHz = buffer.readUInt32LE(offset + 12)
    }
    if (chunkId === "data") {
      const start = offset + 8
      const usable = Math.min(size, buffer.length - start)
      const bytes = buffer.buffer.slice(buffer.byteOffset + start, buffer.byteOffset + start + usable)
      return { samples: new Int16Array(bytes), sampleRateHz }
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error(`${wavPath}: no data chunk`)
}

async function* pacedFrames(
  samples: Int16Array,
  sampleRateHz: number,
  lastSentAt: { wall: number },
): AsyncIterable<PcmFrame> {
  const chunkSamples = Math.floor(sampleRateHz / (1000 / FRAME_MS))
  for (let index = 0; index < samples.length; index += chunkSamples) {
    const piece = samples.subarray(index, Math.min(index + chunkSamples, samples.length))
    lastSentAt.wall = Date.now()
    yield {
      samples: new Int16Array(piece),
      sampleRateHz,
      capturedAt: lastSentAt.wall,
      sequence: index / chunkSamples,
    }
    await new Promise((resolve) => setTimeout(resolve, FRAME_MS))
  }
}

function referenceHits(transcript: string, finalText: string): number {
  const finalWords = new Set(
    finalText
      .toLowerCase()
      .split(/[^a-z0-9À-ÿ]+/u)
      .filter((word) => word.length >= 3),
  )
  return transcript
    .toLowerCase()
    .split(/[^a-z0-9À-ÿ]+/u)
    .filter((word) => word.length >= 3 && finalWords.has(word)).length
}

async function runFixture(
  selection: FixtureSelection,
  endpoint: string,
): Promise<FixtureResult> {
  const corpus = readCorpusFixture(selection.id)
  const wavPath = join(CORPUS_DIR, corpus.path)
  const wavBytes = readFileSync(wavPath)
  const shaMatches = createHash("sha256").update(wavBytes).digest("hex") === corpus.sha256
  const { samples, sampleRateHz } = readWavMonoPcm16(wavPath)

  const provider = createNemoStreamingSttProvider(nemoDeps(endpoint))
  await provider.prepare({ language: selection.language })

  const lastSentAt = { wall: Date.now() }
  const startedAt = Date.now()
  let partialCount = 0
  let firstTextPartialMs: number | null = null
  let finalLatencyMs: number | null = null
  let finalText = ""
  const errorCodes: string[] = []
  for await (const event of provider.transcribe(
    pacedFrames(samples, sampleRateHz, lastSentAt),
    new AbortController().signal,
  )) {
    if (event.kind === "partial") {
      partialCount++
      if (firstTextPartialMs === null && event.text.trim().length > 0) {
        firstTextPartialMs = Date.now() - startedAt
      }
      continue
    }
    if (event.kind === "final") {
      finalText = event.text.trim()
      finalLatencyMs = Date.now() - lastSentAt.wall
      continue
    }
    if (event.kind === "error") {
      errorCodes.push(`${event.code}${event.recovered ? ":recovered" : ""}`)
    }
  }

  return {
    id: selection.id,
    language: selection.language,
    shaMatches,
    audioDurationMs: corpus.durationMs,
    partialCount,
    firstTextPartialMs,
    finalLatencyMs,
    finalText,
    referenceWordsHit: referenceHits(corpus.transcript, finalText),
    errorCodes,
  }
}

describe("nemo streaming STT end-to-end (live server)", () => {
  test.skipIf(!E2E_URL)(
    "five nominal languages produce a faithful final through the real provider",
    async () => {
      const endpoint = E2E_URL ?? ""
      const results: FixtureResult[] = []
      mkdirSync(join(RESULTS_PATH, ".."), { recursive: true })
      // happy-dom's fetch applies browser CORS to 127.0.0.1; the probe
      // and route-around must use the native network path.
      const native = Bun.fetch
      const patched = globalThis.fetch
      globalThis.fetch = native
      try {
        // Warm-up (discarded): the first turn after server start pays
        // model warm-up that sustained product usage does not — record
        // it separately rather than as a measured fixture.
        const warmup = await runFixture(FIXTURES[0], endpoint)
        for (const selection of FIXTURES) {
          results.push(await runFixture(selection, endpoint))
        }
        writeFileSync(
          `${RESULTS_PATH}.warmup.json`,
          JSON.stringify({ endpoint, fixture: warmup, at: new Date().toISOString() }, null, 2),
        )
      } finally {
        globalThis.fetch = patched
        writeFileSync(
          RESULTS_PATH,
          JSON.stringify(
            { endpoint, fixtures: results, warmup: FIXTURES[0]?.id, at: new Date().toISOString() },
            null,
            2,
          ),
        )
      }

      expect(results).toHaveLength(FIXTURES.length)
      for (const result of results) {
        expect(result.shaMatches, `${result.id}: wav sha256 must match the corpus`).toBe(true)
        expect(result.errorCodes, `${result.id}: no unexpected provider errors`).toEqual(
          result.errorCodes.filter((code) => code === "STREAM_EMPTY_FINAL:recovered"),
        )
        expect(result.finalText, `${result.id}: final transcript must not be empty`).not.toBe("")
        expect(
          result.referenceWordsHit,
          `${result.id}: final must share at least one content word with the reference`,
        ).toBeGreaterThan(0)
        expect(result.partialCount, `${result.id}: streaming partials were emitted`).toBeGreaterThan(0)
        expect(
          result.firstTextPartialMs,
          `${result.id}: a non-empty partial must arrive while the utterance plays`,
        ).not.toBeNull()
        expect(
          result.firstTextPartialMs ?? Number.POSITIVE_INFINITY,
          `${result.id}: partial arrives during audio (streaming, not post-hoc)`,
        ).toBeLessThan(result.audioDurationMs)
        expect(
          result.firstTextPartialMs ?? Number.POSITIVE_INFINITY,
          `${result.id}: first text partial within the ${FIRST_PARTIAL_BUDGET_MS} ms sanity bound`,
        ).toBeLessThan(FIRST_PARTIAL_BUDGET_MS)
        expect(
          result.finalLatencyMs ?? Number.POSITIVE_INFINITY,
          `${result.id}: final arrives within ${FINAL_BUDGET_MS} ms of the last frame`,
        ).toBeLessThan(FINAL_BUDGET_MS)
      }
    },
    300_000,
  )
})
