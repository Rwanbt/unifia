/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { STREAMING_STT_ERROR_CODES, type PcmFrame, type StreamingSttEvent } from "@unifia/contracts/streaming-stt"
import { createFinalSttFallbackProvider, type FinalAudio } from "./streaming-stt-fallback"

const { AUDIO_FORMAT_UNSUPPORTED, LANGUAGE_UNSUPPORTED, TRANSCRIPTION_FAILED } =
  STREAMING_STT_ERROR_CODES

const RATE = 16_000

function frame(sequence: number, rate = RATE): PcmFrame {
  return { samples: new Int16Array(320), sampleRateHz: rate, capturedAt: sequence * 20, sequence }
}

async function* frames(count: number, rate = RATE): AsyncIterable<PcmFrame> {
  for (let i = 0; i < count; i++) yield frame(i, rate)
}

async function collect(
  provider: ReturnType<typeof createFinalSttFallbackProvider>,
  source: AsyncIterable<PcmFrame>,
  signal: AbortSignal,
): Promise<StreamingSttEvent[]> {
  const events: StreamingSttEvent[] = []
  for await (const event of provider.transcribe(source, signal)) events.push(event)
  return events
}

describe("final STT fallback provider", () => {
  test("advertises honest final-only capabilities", () => {
    const provider = createFinalSttFallbackProvider({ transcribe: async () => "" })
    expect(provider.id).toBe("parakeet-tdt-final")
    expect(provider.capabilities).toEqual({
      providerId: "parakeet-tdt-final",
      languages: ["en", "fr", "es", "it", "de"],
      partials: false,
      retraction: false,
      confidence: false,
      partialLatencyMs: 0,
      finalLatencyMs: 400,
    })
  })

  test("honours injected provider id and latency", () => {
    const provider = createFinalSttFallbackProvider({
      transcribe: async () => "",
      providerId: "parakeet-tdt-streaming",
      languages: ["en"],
      finalLatencyMs: 120,
    })
    expect(provider.id).toBe("parakeet-tdt-streaming")
    expect(provider.capabilities.languages).toEqual(["en"])
    expect(provider.capabilities.finalLatencyMs).toBe(120)
  })

  test("prepare rejects an unoffered language with LANGUAGE_UNSUPPORTED", async () => {
    const provider = createFinalSttFallbackProvider({
      transcribe: async () => "",
      languages: ["en"],
    })
    const err = await provider.prepare({ language: "de" }).catch((error: unknown) => error)
    expect((err as { code?: string }).code).toBe(LANGUAGE_UNSUPPORTED)
  })

  test("prepare rejects when already aborted", async () => {
    const provider = createFinalSttFallbackProvider({ transcribe: async () => "" })
    const abort = new AbortController()
    abort.abort()
    await expect(provider.prepare({ language: "en" }, abort.signal)).rejects.toThrow(/aborted/)
  })

  test("transcribe before prepare throws", async () => {
    const provider = createFinalSttFallbackProvider({ transcribe: async () => "" })
    const err = await collect(provider, frames(1), new AbortController().signal).catch(
      (error: unknown) => error,
    )
    expect((err as Error).message).toContain("prepare()")
  })

  test("buffers the turn and yields exactly one trimmed final", async () => {
    const calls: FinalAudio[] = []
    const provider = createFinalSttFallbackProvider({
      transcribe: async (audio) => {
        calls.push(audio)
        return "  Bonjour le monde  \n"
      },
    })
    await provider.prepare({ language: "fr" })
    const events = await collect(provider, frames(5), new AbortController().signal)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sampleRateHz).toBe(RATE)
    expect(calls[0]?.samples).toHaveLength(5 * 320)
    expect(events.map((event) => event.kind)).toEqual(["final"])
    const final = events[0]
    expect(final?.kind === "final" && final.text).toBe("Bonjour le monde")
    expect(final?.kind === "final" && final.language).toBe("fr")
    expect(final?.kind === "final" && final.fromSequence).toBe(0)
    expect(final?.kind === "final" && final.toSequence).toBe(4)
    expect(events.filter((event) => event.kind === "partial")).toHaveLength(0)
  })

  test("zero frames yields an empty final without calling the runtime", async () => {
    let calls = 0
    const provider = createFinalSttFallbackProvider({
      transcribe: async () => {
        calls++
        return "should not run"
      },
    })
    await provider.prepare({ language: "en" })
    const events = await collect(provider, frames(0), new AbortController().signal)
    expect(calls).toBe(0)
    expect(events.map((event) => event.kind)).toEqual(["final"])
    expect(events[0]?.kind === "final" && events[0].text).toBe("")
  })

  test("mixed sample rates fail with AUDIO_FORMAT_UNSUPPORTED before inference", async () => {
    let calls = 0
    const provider = createFinalSttFallbackProvider({
      transcribe: async () => {
        calls++
        return "x"
      },
    })
    await provider.prepare({ language: "en" })
    const source = (async function* () {
      yield frame(0, 16_000)
      yield frame(1, 48_000)
    })()
    const events = await collect(provider, source, new AbortController().signal)
    expect(calls).toBe(0)
    expect(events.map((event) => event.kind)).toEqual(["error"])
    expect(events[0]?.kind === "error" && events[0].code).toBe(AUDIO_FORMAT_UNSUPPORTED)
  })

  test("typed STREAM_ failures keep their canonical code", async () => {
    const provider = createFinalSttFallbackProvider({
      transcribe: () => Promise.reject(Object.assign(new Error("model evicted"), { code: "STREAM_MODEL_CRASHED" })),
    })
    await provider.prepare({ language: "en" })
    const events = await collect(provider, frames(2), new AbortController().signal)
    expect(events.map((event) => event.kind)).toEqual(["error"])
    const err = events[0]
    expect(err?.kind === "error" && err.code).toBe("STREAM_MODEL_CRASHED")
    expect(err?.kind === "error" && err.detail).toContain("model evicted")
  })

  test("untyped failures map to TRANSCRIPTION_FAILED", async () => {
    const provider = createFinalSttFallbackProvider({
      transcribe: () => Promise.reject(new Error("decoder panic")),
    })
    await provider.prepare({ language: "en" })
    const events = await collect(provider, frames(2), new AbortController().signal)
    expect(events.map((event) => event.kind)).toEqual(["error"])
    expect(events[0]?.kind === "error" && events[0].code).toBe(TRANSCRIPTION_FAILED)
    expect(events[0]?.kind === "error" && events[0].recovered).toBe(false)
  })

  test("abort before inference skips the runtime entirely", async () => {
    let calls = 0
    const abort = new AbortController()
    const provider = createFinalSttFallbackProvider({
      transcribe: async () => {
        calls++
        return "x"
      },
    })
    await provider.prepare({ language: "en" })
    const source = (async function* () {
      yield frame(0)
      abort.abort()
      yield frame(1)
    })()
    const events = await collect(provider, source, abort.signal)
    expect(calls).toBe(0)
    expect(events).toEqual([])
  })
})
