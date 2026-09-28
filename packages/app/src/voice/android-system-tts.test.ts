/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { TTS_ERROR_CODES, type TtsAudioChunk, type TtsProviderError } from "@unifia/contracts/tts-router"
import { AndroidSystemTtsBackend, decodeSystemTtsResponse, splitSpeechPieces } from "./android-system-tts"
import { createTtsRouter } from "./tts-router"

function nativeResponse(sampleRate: number, samples: number[]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(4 + samples.length * 2))
  view.setUint32(0, sampleRate, true)
  samples.forEach((sample, index) => view.setInt16(4 + index * 2, sample, true))
  return view.buffer
}

async function collect(stream: AsyncIterable<TtsAudioChunk | TtsProviderError>) {
  const events: Array<TtsAudioChunk | TtsProviderError> = []
  for await (const event of stream) events.push(event)
  return events
}

describe("splitSpeechPieces", () => {
  test("groups sentences up to the piece limit without splitting words needlessly", () => {
    expect(splitSpeechPieces("Bonjour. Il est midi ! Et toi ?", 20)).toEqual(["Bonjour.", "Il est midi !", "Et toi ?"])
    expect(splitSpeechPieces("Bonjour. Il est midi ! Et toi ?", 280)).toEqual(["Bonjour. Il est midi ! Et toi ?"])
  })

  test("cuts a single overlong sentence into bounded pieces", () => {
    const pieces = splitSpeechPieces("a".repeat(650), 280)
    expect(pieces.map((piece) => piece.length)).toEqual([280, 280, 90])
  })

  test("returns nothing for blank text", () => {
    expect(splitSpeechPieces("   \n ")).toEqual([])
  })
})

describe("decodeSystemTtsResponse", () => {
  test("reads the little-endian rate header then PCM16", () => {
    const decoded = decodeSystemTtsResponse(nativeResponse(24_000, [1, -2, 32767]))
    expect(decoded.sampleRateHz).toBe(24_000)
    expect(Array.from(decoded.samples)).toEqual([1, -2, 32767])
  })

  test("accepts a byte array as Tauri may deliver it", () => {
    const bytes = Array.from(new Uint8Array(nativeResponse(16_000, [5])))
    expect(Array.from(decodeSystemTtsResponse(bytes).samples)).toEqual([5])
  })

  test("rejects a truncated response", () => {
    expect(() => decodeSystemTtsResponse(new ArrayBuffer(2))).toThrow("SYSTEM_TTS_FAILED")
  })
})

describe("AndroidSystemTtsBackend", () => {
  test("synthesises each piece natively, in order, and flags the last chunk final", async () => {
    const calls: Array<Record<string, unknown> | undefined> = []
    const backend = new AndroidSystemTtsBackend(async (_command, args) => {
      calls.push(args)
      return nativeResponse(24_000, [calls.length])
    })
    await backend.prepare({ language: "fr", speed: 1.1 })

    const events = (await collect(backend.synthesize("Bonjour. Au revoir.", new AbortController().signal))) as TtsAudioChunk[]

    expect(calls).toEqual([
      { text: "Bonjour. Au revoir.", language: "fr", rate: 1.1 },
    ])
    expect(events.map((event) => [event.sampleRateHz, event.final])).toEqual([[24_000, true]])
  })

  test("a missing offline voice is a non-recoverable language error", async () => {
    const backend = new AndroidSystemTtsBackend(async () => {
      throw new Error("SYSTEM_TTS_LANGUAGE_UNAVAILABLE: no offline voice installed for fr")
    })
    await backend.prepare({ language: "fr", speed: 1 })

    const [event] = (await collect(backend.synthesize("Bonjour", new AbortController().signal))) as TtsProviderError[]

    expect(event).toMatchObject({ code: TTS_ERROR_CODES.LANGUAGE_UNSUPPORTED, recoverable: false })
  })

  test("an engine that cannot start is a recoverable provider-offline error", async () => {
    const backend = new AndroidSystemTtsBackend(async () => {
      throw new Error("SYSTEM_TTS_UNAVAILABLE: no text-to-speech engine could start")
    })
    await backend.prepare({ language: "en", speed: 1 })

    const [event] = (await collect(backend.synthesize("Hello", new AbortController().signal))) as TtsProviderError[]

    expect(event).toMatchObject({ code: TTS_ERROR_CODES.PROVIDER_OFFLINE, recoverable: true })
  })

  test("stops before the next piece once aborted", async () => {
    const controller = new AbortController()
    let calls = 0
    const backend = new AndroidSystemTtsBackend(async () => {
      calls++
      controller.abort()
      return nativeResponse(24_000, [1])
    })
    await backend.prepare({ language: "en", speed: 1 })

    const events = await collect(backend.synthesize(`${"a".repeat(300)}. Second.`, controller.signal))

    expect(calls).toBe(1)
    expect(events).toEqual([])
  })

  test("is the router's local, production-ready fallback and never reports as Pocket", async () => {
    const backend = new AndroidSystemTtsBackend(async () => nativeResponse(24_000, [1]))
    const router = createTtsRouter([backend])

    expect(backend.capabilities).toMatchObject({ providerId: "fallback-android-tts", remoteCapable: false, productionReady: true })
    expect(await router.prepare("de")).toBe("fallback-android-tts")
  })
})
