/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { TTS_ERROR_CODES, type TtsAudioChunk, type TtsProviderError } from "@unifia/contracts/tts-router"
import { createAndroidTtsRouter } from "./android-tts-router"
import { decodePocketChunk, PocketAndroidBackend } from "./pocket-android-tts"

function chunkBytes(sampleRate: number, samples: number[]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(4 + samples.length * 2))
  view.setUint32(0, sampleRate, true)
  samples.forEach((sample, index) => view.setInt16(4 + index * 2, sample, true))
  return view.buffer
}

/** A fake native side: streams the queued chunks, then an end-of-stream chunk. */
function nativePocket(options: { chunks?: number[][]; prepareError?: string } = {}) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  let pending = [...(options.chunks ?? [[1, 2], [3]])]
  const invoke = async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args })
    if (command === "voice_pocket_prepare" && options.prepareError) throw options.prepareError
    if (command === "voice_pocket_stream_start") return 7
    if (command === "voice_pocket_stream_read") {
      const next = pending.shift()
      return next ? chunkBytes(24_000, next) : chunkBytes(0, [])
    }
    if (command === "voice_pocket_stream_end") pending = []
    return null
  }
  return { invoke, calls }
}

async function collect(stream: AsyncIterable<TtsAudioChunk | TtsProviderError>) {
  const events: Array<TtsAudioChunk | TtsProviderError> = []
  for await (const event of stream) events.push(event)
  return events
}

describe("decodePocketChunk", () => {
  test("reads the rate header then PCM16, and a zero rate marks the end", () => {
    expect(Array.from(decodePocketChunk(chunkBytes(24_000, [1, -2])).samples)).toEqual([1, -2])
    expect(decodePocketChunk(chunkBytes(0, [])).sampleRateHz).toBe(0)
  })

  test("rejects a truncated chunk", () => {
    expect(() => decodePocketChunk(new ArrayBuffer(1))).toThrow("POCKET_FAILED")
  })
})

describe("PocketAndroidBackend", () => {
  test("prepares the language pack natively and streams every chunk, then a final one", async () => {
    const native = nativePocket()
    const backend = new PocketAndroidBackend(native.invoke)
    await backend.prepare({ language: "fr", speed: 1 })

    const events = (await collect(backend.synthesize("Bonjour.", new AbortController().signal))) as TtsAudioChunk[]

    expect(native.calls[0]).toEqual({ command: "voice_pocket_prepare", args: { language: "fr" } })
    expect(events.map((event) => [Array.from(event.samples), event.final])).toEqual([
      [[1, 2], false],
      [[3], false],
      [[], true],
    ])
    expect(native.calls.at(-1)).toEqual({ command: "voice_pocket_stream_end", args: { id: 7 } })
  })

  test("a missing language pack is reported and never replaced by another voice", async () => {
    const native = nativePocket({ prepareError: "POCKET_MODEL_MISSING: no complete Pocket pack for 'fr'" })
    const router = createAndroidTtsRouter(native.invoke)

    const events = await collect(router.synthesize({ id: "r", text: "Bonjour", language: "fr", speed: 1 }, new AbortController().signal))

    // The router reports the missing pack, then ends with an explicit
    // terminal error: no other provider exists to substitute.
    expect(events[0]).toMatchObject({ code: TTS_ERROR_CODES.MODEL_MISSING })
    expect(events.at(-1)).toMatchObject({ recoverable: false })
    expect(events.some((event) => "samples" in event)).toBe(false)
    expect(native.calls.map((call) => call.command)).toEqual(["voice_pocket_prepare"])
  })

  test("aborting ends the native stream and stops yielding", async () => {
    const controller = new AbortController()
    const native = nativePocket({ chunks: [[1], [2], [3]] })
    const backend = new PocketAndroidBackend(native.invoke)
    await backend.prepare({ language: "en", speed: 1 })

    const events: TtsAudioChunk[] = []
    for await (const event of backend.synthesize("Hello", controller.signal)) {
      events.push(event as TtsAudioChunk)
      controller.abort()
    }

    expect(events).toHaveLength(1)
    expect(native.calls.filter((call) => call.command === "voice_pocket_stream_end")).toHaveLength(1)
  })

  test("advertises a local, production-ready, CPU-only voice", () => {
    expect(new PocketAndroidBackend(async () => null).capabilities).toMatchObject({
      providerId: "pocket",
      productionReady: true,
      remoteCapable: false,
      cpuOnly: true,
    })
  })
})
