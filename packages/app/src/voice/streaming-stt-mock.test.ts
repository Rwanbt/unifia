/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  createMockStreamingSttProvider,
  finalTranscript,
  partialHypothesis,
  providerError,
  StreamingSttErrorCodes,
} from "./streaming-stt-mock"
import type { PcmFrame } from "@unifia/contracts/streaming-stt"

async function* silentFrames(count: number): AsyncIterable<PcmFrame> {
  for (let i = 0; i < count; i++) {
    yield {
      samples: new Int16Array(320),
      sampleRateHz: 16000,
      capturedAt: i * 20,
      sequence: i,
    }
  }
}

describe("MockStreamingSttProvider", () => {
  test("reports the correct capabilities from the script", () => {
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["en", "fr"],
      script: [
        partialHypothesis({ text: "Bon", stable: false, language: "fr", capturedAt: 0, lastSequence: 0 }),
        finalTranscript({
          text: "Bonjour",
          language: "fr",
          capturedAt: 100,
          fromSequence: 0,
          toSequence: 5,
        }),
      ],
    })
    expect(provider.id).toBe("deterministic-mock")
    expect(provider.capabilities.providerId).toBe("deterministic-mock")
    expect(provider.capabilities.languages).toEqual(["en", "fr"])
    expect(provider.capabilities.partials).toBe(true)
    expect(provider.capabilities.confidence).toBe(false)
  })

  test("replays partials and final in order, then exhausts", async () => {
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["en"],
      script: [
        partialHypothesis({ text: "Hel", stable: false, language: "en", capturedAt: 0, lastSequence: 0 }),
        partialHypothesis({
          text: "Hello",
          stable: false,
          language: "en",
          capturedAt: 100,
          lastSequence: 5,
        }),
        partialHypothesis({ text: "Hello world", stable: true, language: "en", capturedAt: 200, lastSequence: 10 }),
        finalTranscript({
          text: "Hello world",
          language: "en",
          capturedAt: 250,
          fromSequence: 0,
          toSequence: 10,
        }),
      ],
    })
    await provider.prepare({ language: "en" })
    const received: string[] = []
    for await (const event of provider.transcribe(silentFrames(15), new AbortController().signal)) {
      if (event.kind === "partial") {
        received.push(`partial:${event.stable}:${event.text}`)
      } else if (event.kind === "final") {
        received.push(`final:${event.text}`)
      } else {
        received.push(`error:${event.code}`)
      }
    }
    await provider.dispose()
    expect(received).toEqual([
      "partial:false:Hel",
      "partial:false:Hello",
      "partial:true:Hello world",
      "final:Hello world",
    ])
  })

  test("respects AbortSignal mid-iteration and does not emit further events", async () => {
    const abort = new AbortController()
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["en"],
      perFrameDelayMs: 5,
      script: [
        partialHypothesis({ text: "Hel", stable: false, language: "en", capturedAt: 0, lastSequence: 0 }),
        partialHypothesis({
          text: "Hello",
          stable: false,
          language: "en",
          capturedAt: 100,
          lastSequence: 5,
        }),
        partialHypothesis({ text: "Hello world", stable: true, language: "en", capturedAt: 200, lastSequence: 10 }),
        finalTranscript({
          text: "Hello world",
          language: "en",
          capturedAt: 250,
          fromSequence: 0,
          toSequence: 10,
        }),
      ],
    })
    await provider.prepare({ language: "en" })
    const received: string[] = []
    for await (const event of provider.transcribe(silentFrames(15), abort.signal)) {
      received.push(event.kind)
      if (received.length === 1) abort.abort()
    }
    await provider.dispose()
    expect(received).toEqual(["partial"])
  })

  test("propagates ProviderError events without aborting the consumer", async () => {
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["en"],
      script: [
        partialHypothesis({ text: "Hel", stable: false, language: "en", capturedAt: 0, lastSequence: 0 }),
        providerError(StreamingSttErrorCodes.INFERENCE_TIMEOUT, "decoder stalled", false, 100),
        partialHypothesis({
          text: "Hello",
          stable: false,
          language: "en",
          capturedAt: 200,
          lastSequence: 5,
        }),
        finalTranscript({
          text: "Hello",
          language: "en",
          capturedAt: 250,
          fromSequence: 0,
          toSequence: 5,
        }),
      ],
    })
    await provider.prepare({ language: "en" })
    const events: string[] = []
    for await (const event of provider.transcribe(silentFrames(15), new AbortController().signal)) {
      if (event.kind === "error") events.push(`error:${event.code}:${event.recovered}`)
      else events.push(event.kind)
    }
    await provider.dispose()
    expect(events).toEqual(["partial", "error:STREAM_INFERENCE_TIMEOUT:false", "partial", "final"])
  })

  test("scripts with no partials report capabilities.partials=false", () => {
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["en"],
      script: [
        finalTranscript({
          text: "Bonjour.",
          language: "en",
          capturedAt: 250,
          fromSequence: 0,
          toSequence: 10,
        }),
      ],
    })
    expect(provider.capabilities.partials).toBe(false)
  })

  test("confidence flag is true when every partial carries a confidence value", () => {
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["en"],
      script: [
        partialHypothesis({
          text: "Hel",
          stable: false,
          language: "en",
          capturedAt: 0,
          lastSequence: 0,
          confidence: 0.42,
        }),
        finalTranscript({
          text: "Hello",
          language: "en",
          capturedAt: 250,
          fromSequence: 0,
          toSequence: 5,
          confidence: 0.95,
        }),
      ],
    })
    expect(provider.capabilities.confidence).toBe(true)
  })

  test("scripts with only finals and no partials are valid", async () => {
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["fr"],
      script: [
        finalTranscript({
          text: "Bonjour.",
          language: "fr",
          capturedAt: 250,
          fromSequence: 0,
          toSequence: 5,
        }),
      ],
    })
    await provider.prepare({ language: "fr" })
    const received: string[] = []
    for await (const event of provider.transcribe(silentFrames(10), new AbortController().signal)) {
      received.push(event.kind)
    }
    await provider.dispose()
    expect(received).toEqual(["final"])
  })

  test("prepare throws when the abort signal is already aborted", async () => {
    const provider = createMockStreamingSttProvider({
      id: "deterministic-mock",
      languages: ["en"],
      script: [],
    })
    const abort = new AbortController()
    abort.abort()
    await expect(provider.prepare({ language: "en" }, abort.signal)).rejects.toThrow(/aborted/)
  })
})
