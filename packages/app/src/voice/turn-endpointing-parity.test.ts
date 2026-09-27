/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { DEFAULT_TURN_ENDPOINTING_OPTIONS, TurnEndpointing, type TurnEndpointingEvent } from "./turn-endpointing"

/** Cross-runtime EOT parity (G4): the same committed probability sequences
 * must drive identical commit/decline decisions in TypeScript
 * (`TurnEndpointing`) and in the Android Rust `CaptureSegmenter` (asserted by
 * `voice::native_audio::eot_corpus_tests::turn_endpointing_parity_fixture_*`
 * in packages/mobile/src-tauri). The fixture
 * `packages/voice-core/fixtures/turn-endpointing-parity.json` holds the
 * Silero v6.2.2 per-frame sequences for all 91 fixtures of the pinned
 * `unifia-eot-bench` corpus plus 10 hand-authored boundary cases. Regenerate
 * with `EOT_PARITY_REGENERATE=1 cargo test --lib \
 * voice::native_audio::eot_corpus_tests::write_turn_endpointing_parity_fixture -- --ignored`. */
interface ParityEvent {
  frame: number
  type: "speech-started" | "utterance-finalized"
  durationMs?: number
  reason?: "silence" | "maximum-duration"
}

interface ParityCase {
  name: string
  frameMs: number
  frameSamples: number
  frames: number[]
  events: ParityEvent[]
}

const fixture = (await Bun.file(new URL("../../../voice-core/fixtures/turn-endpointing-parity.json", import.meta.url)).json()) as {
  version: number
  source: { corpus: string; corpusVersion: string; modelId: string; modelSha256: string; generatedBy: string }
  options: typeof DEFAULT_TURN_ENDPOINTING_OPTIONS
  cases: ParityCase[]
}

const casesByName = new Map(fixture.cases.map((parityCase) => [parityCase.name, parityCase]))

function mustGet(name: string): ParityCase {
  const parityCase = casesByName.get(name)
  if (!parityCase) throw new Error(`missing parity case ${name}`)
  return parityCase
}

/** Drives one parity case through `TurnEndpointing`, tagging every emitted
 * event with the frame index that produced it (the shared event vocabulary). */
function observe(parityCase: ParityCase): ParityEvent[] {
  const endpointing = new TurnEndpointing(fixture.options)
  const observed: ParityEvent[] = []
  parityCase.frames.forEach((probability, frame) => {
    const events: TurnEndpointingEvent[] = endpointing.accept(probability, parityCase.frameMs)
    for (const event of events) {
      if (event.type === "speech-started") observed.push({ frame, type: event.type })
      else observed.push({ frame, ...event })
    }
  })
  return observed
}

describe("turn endpointing parity (Rust CaptureSegmenter fixture)", () => {
  test("fixture is present, versioned and pinned to the shared options", () => {
    expect(fixture.version).toBe(1)
    expect(fixture.source.corpus).toBe("unifia-eot-bench")
    expect(fixture.source.corpusVersion).toBe("2.0.0")
    expect(fixture.source.modelId).toBe("silero-vad-v6.2.2-onnx")
    expect(fixture.source.modelSha256).toBe("1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3")
    expect(fixture.options).toEqual(DEFAULT_TURN_ENDPOINTING_OPTIONS)
    expect(fixture.cases.filter((parityCase) => parityCase.name.startsWith("synthetic/")).length).toBe(10)
    expect(fixture.cases.filter((parityCase) => parityCase.name.startsWith("corpus/")).length).toBe(91)
    expect(casesByName.size).toBe(fixture.cases.length)
    for (const parityCase of fixture.cases) {
      expect((parityCase.frameSamples * 1_000) / 16_000).toBe(parityCase.frameMs)
    }
  })

  test("TurnEndpointing reproduces every committed decision", () => {
    for (const parityCase of fixture.cases) {
      expect({ name: parityCase.name, events: observe(parityCase) }).toEqual({ name: parityCase.name, events: parityCase.events })
    }
  })

  test("boundary cases exercise the calibrated decision edges", () => {
    // Exactly 0.5 opens a turn; the next-below f32 never does.
    expect(observe(mustGet("synthetic/threshold-edge"))).toEqual([{ frame: 2, type: "speech-started" }])
    // Exactly 280 ms of speech still commits; below it is discarded.
    expect(observe(mustGet("synthetic/minimum-speech-exact"))).toEqual([
      { frame: 0, type: "speech-started" },
      { frame: 23, type: "utterance-finalized", durationMs: 280, reason: "silence" },
    ])
    expect(observe(mustGet("synthetic/below-minimum-discarded"))).toEqual([{ frame: 0, type: "speech-started" }])
    // Exactly 650 ms of silence commits on the 5th 130 ms frame, not the 4th.
    expect(observe(mustGet("synthetic/trailing-silence-exact-650"))).toEqual([
      { frame: 0, type: "speech-started" },
      { frame: 7, type: "utterance-finalized", durationMs: 390, reason: "silence" },
    ])
    // A 640 ms internal pause resumes; 672 ms splits the turn.
    expect(observe(mustGet("synthetic/internal-pause-resume"))).toEqual([
      { frame: 0, type: "speech-started" },
      { frame: 55, type: "utterance-finalized", durationMs: 480, reason: "silence" },
    ])
    expect(observe(mustGet("synthetic/pause-splits-turn"))).toEqual([
      { frame: 0, type: "speech-started" },
      { frame: 30, type: "utterance-finalized", durationMs: 320, reason: "silence" },
      { frame: 31, type: "speech-started" },
      { frame: 61, type: "utterance-finalized", durationMs: 320, reason: "silence" },
    ])
    // Maximum duration commits at exactly 60,000 ms, then a new turn starts.
    expect(observe(mustGet("synthetic/restart-after-max"))).toEqual([
      { frame: 0, type: "speech-started" },
      { frame: 199, type: "utterance-finalized", durationMs: 60_000, reason: "maximum-duration" },
      { frame: 205, type: "speech-started" },
      { frame: 217, type: "utterance-finalized", durationMs: 3_000, reason: "silence" },
    ])
    // Clipped corpus fixtures only open a turn; the missing trailing silence
    // before EOF must never commit one.
    for (const language of ["en", "fr", "es", "it", "de"]) {
      const observed = observe(mustGet(`corpus/${language}-clip-01`))
      expect(observed.length).toBe(1)
      expect(observed[0]?.type).toBe("speech-started")
    }
  })
})
