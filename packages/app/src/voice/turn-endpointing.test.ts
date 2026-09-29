/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { TurnEndpointing } from "./turn-endpointing"

const options = {
  speechThreshold: 0.5,
  minimumSpeechMs: 300,
  trailingSilenceMs: 600,
  maximumUtteranceMs: 1_200,
}

describe("TurnEndpointing", () => {
  test("waits for stable trailing silence before finalizing a speech turn", () => {
    const endpointing = new TurnEndpointing(options)
    expect(endpointing.accept(0.9, 100)).toEqual([{ type: "speech-started" }])
    endpointing.accept(0.9, 300)
    expect(endpointing.accept(0.1, 400)).toEqual([])
    expect(endpointing.accept(0.1, 200)).toEqual([
      { type: "utterance-finalized", durationMs: 400, reason: "silence" },
    ])
    expect(endpointing.isSpeechActive).toBe(false)
  })

  test("discards short noise instead of emitting an utterance", () => {
    const endpointing = new TurnEndpointing(options)
    endpointing.accept(0.9, 100)
    endpointing.accept(0.1, 600)
    expect(endpointing.isSpeechActive).toBe(false)
  })

  test("bounds a continuous utterance and can start the next one", () => {
    const endpointing = new TurnEndpointing(options)
    endpointing.accept(0.9, 600)
    expect(endpointing.accept(0.9, 600)).toEqual([
      { type: "utterance-finalized", durationMs: 1_200, reason: "maximum-duration" },
    ])
    expect(endpointing.accept(0.9, 100)).toEqual([{ type: "speech-started" }])
  })

  test("rejects invalid frame measurements", () => {
    const endpointing = new TurnEndpointing(options)
    expect(() => endpointing.accept(Number.NaN, 20)).toThrow(RangeError)
    expect(() => endpointing.accept(0.9, 0)).toThrow(RangeError)
  })
})
