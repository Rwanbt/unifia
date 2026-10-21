/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { emitSpeech, onSpeech, speechEvents, type SpeechEndDetail } from "./speech-events"

describe("speech events", () => {
  test("the table keeps the historical names the shells already dispatch", () => {
    expect(speechEvents).toEqual({
      sttStart: "stt-start",
      sttStop: "stt-stop",
      speechEnded: "speech-ended",
      sttLevel: "stt-level",
      ttsToggle: "tts-toggle",
      ttsAutoplay: "tts-autoplay",
      ttsLiveStart: "tts-live-start",
      ttsLiveEnded: "tts-live-ended",
    })
  })

  test("a payload event round-trips with its detail", () => {
    const target = new EventTarget()
    const seen: SpeechEndDetail[] = []
    onSpeech(target, speechEvents.speechEnded, (detail) => seen.push(detail))

    emitSpeech(target, speechEvents.speechEnded, { kind: "stt", reason: "denied", code: "mic_denied" })
    expect(seen).toEqual([{ kind: "stt", reason: "denied", code: "mic_denied" }])
  })

  test("a payload-free event dispatches without detail", () => {
    const target = new EventTarget()
    let calls = 0
    onSpeech(target, speechEvents.sttStart, () => {
      calls += 1
    })

    emitSpeech(target, speechEvents.sttStart, undefined)
    expect(calls).toBe(1)
  })

  test("the level event carries its value", () => {
    const target = new EventTarget()
    const levels: number[] = []
    onSpeech(target, speechEvents.sttLevel, (detail) => levels.push(detail.level))

    emitSpeech(target, speechEvents.sttLevel, { level: 0.42 })
    expect(levels).toEqual([0.42])
  })

  test("unsubscribing stops delivery", () => {
    const target = new EventTarget()
    let calls = 0
    const off = onSpeech(target, speechEvents.sttStop, () => {
      calls += 1
    })

    emitSpeech(target, speechEvents.sttStop, undefined)
    off()
    emitSpeech(target, speechEvents.sttStop, undefined)
    expect(calls).toBe(1)
  })
})
