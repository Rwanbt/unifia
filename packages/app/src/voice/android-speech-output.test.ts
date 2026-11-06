/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createAndroidSpeechOutput, resampleLinear } from "./android-speech-output"
import * as speech from "./android-speech-output"
import { AudioPlaybackCoordinator } from "./audio-playback-coordinator"
import { createSystemVoiceFallback } from "./android-system-tts"
import type { SpeechLanguage, TtsRequest } from "@unifia/contracts/speech"
import type { TtsAudioChunk, TtsRouter } from "@unifia/contracts/tts-router"

const NATIVE_RATE = 48_000

function chunk(sequence: number, frames: number, sampleRateHz = 22_050, final = false): TtsAudioChunk {
  const samples = new Int16Array(frames)
  for (let i = 0; i < frames; i++) samples[i] = 1000 + sequence
  return { samples, sampleRateHz, generatedAt: sequence * 22, sequence, final }
}

function routerOver(chunks: TtsAudioChunk[]): TtsRouter {
  return {
    voices: {} as never,
    async prepare() { return "pocket" },
    async *synthesize(_request: TtsRequest) {
      for (const c of chunks) yield c
    },
    async cancel() {},
    async dispose() {},
  }
}

/** A router with no registered backend: `prepare` fails and `synthesize`
 *  yields no PCM at all. This is the real shape of the router before any
 *  production backend exists, and it is the case that must never be
 *  reported as a successful Pocket synthesis. */
function emptyRouter(): TtsRouter {
  const base = routerOver([])
  return {
    ...base,
    async prepare() {
      throw new Error("no TTS provider is registered")
    },
  }
}

describe("createAndroidSpeechOutput", () => {
  test("routes PCM through the router to native output and reports the provider that spoke", async () => {
    const writes: number[][] = []
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      if (command === "voice_audio_write_pcm") {
        const samples = args?.samples as number[]
        writes.push(samples)
        return samples.length
      }
      return null
    }
    const backends: string[] = []
    const output = createAndroidSpeechOutput({
      invoke,
      router: routerOver([chunk(0, 480), chunk(1, 480, 22_050, true)]),
      coordinator: new AudioPlaybackCoordinator(),
      onBackendUsed: (backend) => backends.push(backend),
    })

    const backend = await output.speak("Bonjour", "fr" as SpeechLanguage, 1, "live")

    expect(backend).toBe("pocket")
    expect(backends).toEqual(["pocket"])
    expect(writes).toHaveLength(2)
    // 480 frames @ 22050 -> ~1045 frames @ 48000
    expect(writes[0]!.length).toBeGreaterThan(1000)
    expect(writes[0]!.length).toBeLessThan(1100)
  })

  test("reports unavailable instead of substituting another voice when no neural backend speaks", async () => {
    const backends: string[] = []
    const output = createAndroidSpeechOutput({
      invoke: async () => null,
      router: emptyRouter(),
      coordinator: new AudioPlaybackCoordinator(),
      onBackendUsed: (backend) => backends.push(backend),
    })

    const backend = await output.speak("Bonjour", "fr" as SpeechLanguage, 1.2, "live")

    expect(backend).toBe("unavailable")
    expect(backends).toEqual(["unavailable"])
  })

  test("prepare never throws when no speech backend is available", async () => {
    const output = createAndroidSpeechOutput({
      invoke: async () => null,
      router: emptyRouter(),
      coordinator: new AudioPlaybackCoordinator(),
    })
    await expect(output.prepare("de" as SpeechLanguage)).resolves.toBeUndefined()
  })

  test("D10: stays unavailable when no system-voice fallback was supplied", async () => {
    // The default wiring supplies no fallback at all, so an absent Pocket
    // pack must still report `unavailable` rather than reaching the platform.
    const output = createAndroidSpeechOutput({
      invoke: async () => null,
      router: emptyRouter(),
      coordinator: new AudioPlaybackCoordinator(),
    })

    expect(await output.speak("Bonjour", "fr" as SpeechLanguage, 1, "live")).toBe("unavailable")
  })

  test("D10: routes to the platform voice when the fallback is enabled", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const spoken: { text: string; priority: string; speed: number }[] = []
    const backends: string[] = []
    const output = createAndroidSpeechOutput({
      invoke: async () => null,
      router: emptyRouter(),
      coordinator,
      systemVoice: createSystemVoiceFallback({
        enabled: true,
        engine: {
          voices: () => [{ lang: "fr-FR", name: "Google français", default: true }],
          speak: async (request) => { spoken.push({ text: request.text, priority: "live", speed: request.rate }) },
          cancel: () => {},
        },
        coordinator,
      }),
      onBackendUsed: (backend) => backends.push(backend),
    })

    const backend = await output.speak("Bonjour", "fr" as SpeechLanguage, 1.2, "live")

    expect(backend).toBe("fallback-android-tts")
    // Reported under its own id: a system voice is never counted as Pocket.
    expect(backends).toEqual(["fallback-android-tts"])
    expect(spoken).toEqual([{ text: "Bonjour", priority: "live", speed: 1.2 }])
  })

  test("D10: a disabled fallback leaves the unavailable result untouched", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const engine = {
      voices: () => [{ lang: "fr-FR", name: "Google français", default: true }],
      speak: async () => { throw new Error("must never be reached") },
      cancel: () => {},
    }
    const backends: string[] = []
    const output = createAndroidSpeechOutput({
      invoke: async () => null,
      router: emptyRouter(),
      coordinator,
      systemVoice: createSystemVoiceFallback({ enabled: false, engine, coordinator }),
      onBackendUsed: (backend) => backends.push(backend),
    })

    expect(await output.speak("Bonjour", "fr" as SpeechLanguage, 1, "live")).toBe("unavailable")
    expect(backends).toEqual(["unavailable"])
  })

  test("D10: Pocket still wins when it produces audio, even with the fallback enabled", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const engine = {
      voices: () => [{ lang: "fr-FR", name: "Google français", default: true }],
      speak: async () => { throw new Error("the local voice must be preferred") },
      cancel: () => {},
    }
    const writes: number[][] = []
    const output = createAndroidSpeechOutput({
      invoke: async (command, args) => {
        if (command !== "voice_audio_write_pcm") return null
        const samples = args?.samples as number[]
        writes.push(samples)
        return samples.length
      },
      router: routerOver([chunk(0, 480, NATIVE_RATE, true)]),
      coordinator,
      systemVoice: createSystemVoiceFallback({ enabled: true, engine, coordinator }),
    })

    // D10 says Pocket stays the local voice. The fallback is a fallback, not a
    // replacement, so it must never run while Pocket is producing PCM.
    expect(await output.speak("Bonjour", "fr" as SpeechLanguage, 1, "live")).toBe("pocket")
    expect(writes).toHaveLength(1)
  })

  test("a lower-priority utterance cannot preempt higher-priority playback", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const output = createAndroidSpeechOutput({
      invoke: async () => null,
      router: emptyRouter(),
      coordinator,
    })

    const live = output.speak("long", "en" as SpeechLanguage, 1, "live")
    // Simulate the live lease still being held.
    const held = coordinator.acquire("live", () => {})
    expect(held).toBeDefined()
    const manual = await output.speak("short", "en" as SpeechLanguage, 1, "manual")

    expect(manual).toBe("suppressed")
    coordinator.release(held!)
    await live
  })

  test("stop() clears the playback lease", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const output = createAndroidSpeechOutput({
      invoke: async () => null,
      router: emptyRouter(),
      coordinator,
    })
    coordinator.acquire("live", () => {})
    output.stop()
    // Lease released: a later utterance is no longer suppressed.
    expect(await output.speak("again", "en" as SpeechLanguage, 1, "manual")).toBe("unavailable")
  })

  test("retries when the native ring applies backpressure instead of dropping audio", async () => {
    let calls = 0
    const total: number[] = []
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      if (command !== "voice_audio_write_pcm") return null
      const samples = args?.samples as number[]
      calls++
      // Accept 400 samples per call to force several partial writes.
      const take = Math.min(400, samples.length)
      total.push(...samples.slice(0, take))
      return take
    }
    const output = createAndroidSpeechOutput({
      invoke,
      router: routerOver([chunk(0, 480, NATIVE_RATE, true)]),
      coordinator: new AudioPlaybackCoordinator(),
    })

    await output.speak("hello", "en" as SpeechLanguage, 1, "live")

    expect(calls).toBeGreaterThan(1)
    expect(total).toHaveLength(480)
  })

  test("AndroidSpeechOutput_LargePocketChunk_PreservesEverySampleBeyondFortyWrites", async () => {
    const samples: number[] = []
    const errors: string[] = []
    const output = createAndroidSpeechOutput({
      invoke: async (_command, args) => {
        const pending = args!.samples as number[]
        const count = Math.min(960, pending.length)
        samples.push(...pending.slice(0, count))
        return count
      },
      router: routerOver([chunk(0, 28_800, 24_000, true)]),
      coordinator: new AudioPlaybackCoordinator(),
      onProviderError: (error) => errors.push(error.detail),
    })
    expect(await output.speak("Bonjour", "fr", 1, "live")).toBe("pocket")
    expect(samples.length).toBe(57_600)
    expect(samples.every((sample) => sample === 1000)).toBe(true)
    expect(errors).toEqual([])
  })

  test("AndroidSpeechOutput_BlockedRing_DoesNotReportSuccessfulSpeech", async () => {
    const errors: string[] = []
    const output = createAndroidSpeechOutput({
      invoke: async () => 0,
      router: routerOver([chunk(0, 480, NATIVE_RATE, true)]),
      coordinator: new AudioPlaybackCoordinator(),
      onProviderError: (error) => errors.push(error.detail),
    })
    expect(await output.speak("Bonjour", "fr", 1, "live")).toBe("unavailable")
    expect(errors.some((error) => error.includes("native playback ring"))).toBe(true)
  })

  test("AndroidSpeechOutput_PartialAudioThenFailure_DoesNotReplayThroughSystemVoice", async () => {
    const coordinator = new AudioPlaybackCoordinator()
    const spoken: string[] = []
    const router = routerOver([])
    router.synthesize = async function* () {
      yield chunk(0, 480, NATIVE_RATE)
      throw new Error("Pocket failed after PCM")
    }
    const output = createAndroidSpeechOutput({
      invoke: async (_command, args) => (args!.samples as number[]).length,
      router,
      coordinator,
      systemVoice: createSystemVoiceFallback({
        enabled: true,
        engine: {
          voices: () => [{ lang: "fr-FR", name: "French", default: true }],
          speak: async (request) => { spoken.push(request.text) },
          cancel: () => {},
        },
        coordinator,
      }),
    })
    expect(await output.speak("Ne pas répéter", "fr", 1, "live")).toBe("unavailable")
    expect(spoken).toEqual([])
  })

  test("AndroidSpeechOutput_FinalEmptyChunk_FlushesTheResamplingTail", async () => {
    const samples: number[] = []
    const output = createAndroidSpeechOutput({
      invoke: async (_command, args) => {
        const pending = args!.samples as number[]
        samples.push(...pending)
        return pending.length
      },
      router: routerOver([
        { ...chunk(0, 2, 24_000), samples: new Int16Array([0, 1000]) },
        { ...chunk(1, 2, 24_000), samples: new Int16Array([2000, 3000]) },
        chunk(2, 0, 24_000, true),
      ]),
      coordinator: new AudioPlaybackCoordinator(),
    })
    expect(await output.speak("Bonjour", "fr", 1, "live")).toBe("pocket")
    expect(samples).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3000])
  })

  test("AndroidSpeechOutput_StopDuringBackpressure_DropsPendingWritesWithoutFallback", async () => {
    let calls = 0
    const output = createAndroidSpeechOutput({
      invoke: async () => {
        calls++
        output.stop()
        return 0
      },
      router: routerOver([chunk(0, 480, NATIVE_RATE, true)]),
      coordinator: new AudioPlaybackCoordinator(),
    })
    expect(await output.speak("Bonjour", "fr", 1, "live")).toBe("suppressed")
    expect(calls).toBe(1)
  })

  for (const count of [-1, 0.5, NaN, Infinity, 481, undefined]) {
    test(`AndroidSpeechOutput_InvalidAcceptedCount${count}_ReportsFailure`, async () => {
      const errors: string[] = []
      const output = createAndroidSpeechOutput({
        invoke: async () => count,
        router: routerOver([chunk(0, 480, NATIVE_RATE, true)]),
        coordinator: new AudioPlaybackCoordinator(),
        onProviderError: (error) => errors.push(error.detail),
      })
      expect(await output.speak("Bonjour", "fr", 1, "live")).toBe("unavailable")
      expect(errors.some((error) => error.includes("invalid sample count"))).toBe(true)
    })
  }
})

describe("resampleLinear", () => {
  test("is a no-op at the same rate", () => {
    const input = new Int16Array([1, 2, 3, 4])
    const result = resampleLinear(input, 24_000, 24_000)
    expect(result.samples).toBe(input)
  })

  test("preserves overall duration and stays within input range", () => {
    const frames = 22_050
    const input = new Int16Array(frames)
    for (let i = 0; i < frames; i++) input[i] = Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 22_050))
    const result = resampleLinear(input, 22_050, 48_000)
    expect(Math.abs(result.samples.length - 48_000)).toBeLessThanOrEqual(2)
    for (const sample of result.samples) {
      expect(sample).toBeGreaterThanOrEqual(-8001)
      expect(sample).toBeLessThanOrEqual(8001)
    }
  })

  for (const rate of [22_050, 24_000, 48_000]) {
    test(`LinearResampler_Split${rate}Hz_MatchesMonolithicPcm`, () => {
      const input = Int16Array.from({ length: 1003 }, (_, index) => Math.round(8000 * Math.sin(index / 11)))
      const expected = resampleLinear(input, rate, 48_000).samples
      const resampler = speech.createLinearResampler(48_000)
      const actual: number[] = []
      for (let offset = 0; offset < input.length; offset += 17) {
        actual.push(...resampler(input.subarray(offset, offset + 17), rate, false))
      }
      actual.push(...resampler(new Int16Array(), rate, true))
      expect(actual.length).toBe(expected.length)
      for (let index = 0; index < expected.length; index++) {
        expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThanOrEqual(1)
      }
    })
  }

  test("LinearResampler_SeparateUtterances_DoNotShareTheirTails", () => {
    const first = speech.createLinearResampler(48_000)
    const second = speech.createLinearResampler(48_000)
    first(new Int16Array([5000]), 24_000, false)
    expect([...second(new Int16Array([-1000]), 24_000, true)]).toEqual([-1000, -1000])
    expect([...first(new Int16Array(), 24_000, true)]).toEqual([5000, 5000])
    expect([...first(new Int16Array(), 24_000, true)]).toEqual([])
  })

  test("LinearResampler_RateChange_RejectsIncompatibleState", () => {
    const resample = speech.createLinearResampler(48_000)
    resample(new Int16Array([1000]), 24_000, false)
    expect(() => resample(new Int16Array([1000]), 22_050, false)).toThrow("sample rate changed")
  })
})
