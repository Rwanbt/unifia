/* SPDX-License-Identifier: MIT */
/**
 * Canonical Android spoken-output path (G8 / campaign §26).
 *
 * Before this module the Android transport called the WebView system voice
 * directly, which meant speech on Android bypassed the canonical
 * `TtsRouter` *and* the shared `AudioPlaybackCoordinator`: Live could
 * overlap manual read-aloud, and the WebView system voice was the only
 * thing that ever spoke. This module makes the routing real:
 *
 *   SpeechSegmenter
 *     -> TtsRouter            (canonical provider order, local-only)
 *       -> PCM chunks
 *         -> playTtsRequest   (Live > manual/preview > autoplay lease)
 *           -> voice_audio_write_pcm   (native Oboe output)
 *
 * When no local neural voice produced audio the honest result is
 * `unavailable` — Android never substitutes the platform's (Google) voice.
 * Owner decision D10 adds one exception, and it is opt-in: if
 * `systemVoice` is supplied (it is supplied only when the user turned the
 * fallback setting on), the platform voice speaks and is reported as
 * `fallback-android-tts`. It is never reported as Pocket, and the spoken
 * provider is the one the router actually prepared.
 */

import type {
  SpeechLanguage,
  TtsRequest,
} from "@unifia/contracts/speech"
import type { TtsProviderId, TtsRouter } from "@unifia/contracts/tts-router"
import type { AudioPlaybackCoordinator, AudioPlaybackPriority } from "./audio-playback-coordinator"
import { SYSTEM_TTS_PROVIDER_ID, type SystemVoiceFallback } from "./android-system-tts"
import { playTtsRequest } from "./tts-playback"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/** Which provider actually produced the audible audio. */
export type AndroidSpeechBackendId = TtsProviderId | "unavailable" | "suppressed"

/** Native Oboe output is opened mono 48 kHz I16 (see `voice/native_audio.rs`). */
const NATIVE_OUTPUT_SAMPLE_RATE_HZ = 48_000

/**
 * Ring-buffer backpressure: when Oboe cannot accept a whole chunk it
 * returns the accepted sample count. Wait briefly and push the rest
 * rather than dropping audio or spinning.
 */
const BACKPRESSURE_WAIT_MS = 12
const MAX_STALLED_WRITES = 40

export interface AndroidSpeechOutputOptions {
  readonly invoke: TauriInvoke
  readonly router: TtsRouter
  readonly coordinator: AudioPlaybackCoordinator
  /**
   * Opt-in platform-voice fallback (D10). Omitted or disabled means Android
   * reports `unavailable` rather than speaking through a system engine.
   */
  readonly systemVoice?: SystemVoiceFallback
  readonly onBackendUsed?: (backend: AndroidSpeechBackendId, detail?: string) => void
  readonly onProviderError?: (failure: { code?: string; detail: string }) => void
}

export interface AndroidSpeechOutput {
  /** Warms the router. Never throws for a missing
   *  neural backend — that is a runtime routing decision, not a start error.
   *  `voice` is the pack-relative conditioning sample, or undefined for the
   *  provider default. */
  prepare(language: SpeechLanguage, voice?: string): Promise<void>
  speak(
    text: string,
    language: SpeechLanguage,
    speed: number,
    priority: AudioPlaybackPriority,
    voice?: string,
  ): Promise<AndroidSpeechBackendId>
  stop(): void
  /** Backend that produced the most recent audible audio. */
  readonly lastBackend: AndroidSpeechBackendId | undefined
}

export function createAndroidSpeechOutput(
  options: AndroidSpeechOutputOptions,
): AndroidSpeechOutput {
  let lastBackend: AndroidSpeechBackendId | undefined
  let stopped = false

  function report(backend: AndroidSpeechBackendId, detail?: string) {
    lastBackend = backend
    options.onBackendUsed?.(backend, detail)
  }

  async function writeChunk(samples: Int16Array, signal: AbortSignal, accepted: () => void): Promise<void> {
    const payload = Array.from(samples)
    let offset = 0
    let stalled = 0
    // A Pocket batch can exceed one second. Bound lack of progress, not the
    // number of partial writes: a healthy draining ring must never lose PCM.
    while (offset < payload.length) {
      if (signal.aborted) return
      const remainder = payload.slice(offset)
      const written = await options.invoke("voice_audio_write_pcm", { samples: remainder })
      if (typeof written !== "number" || !Number.isInteger(written) || written < 0 || written > remainder.length) {
        throw new Error("native playback ring returned an invalid sample count")
      }
      stalled = written > 0 ? 0 : stalled + 1
      if (stalled >= MAX_STALLED_WRITES) throw new Error("native playback ring stopped accepting PCM")
      if (written > 0) accepted()
      offset += written
      if (offset >= payload.length) return
      await delay(BACKPRESSURE_WAIT_MS)
    }
  }

  return {
    get lastBackend() {
      return lastBackend
    },

    async prepare(language, voice) {
      stopped = false
      // A missing or non-production neural backend is not a start failure:
      // the router decides at speak time and falls back honestly.
      await options.router.prepare(language, voice).catch(() => undefined)
    },

    async speak(text, language, speed, priority, voice) {
      if (options.coordinator.outranks(priority)) return "suppressed"
      stopped = false
      const resample = createLinearResampler(NATIVE_OUTPUT_SAMPLE_RATE_HZ)
      let played = 0
      const request: TtsRequest = {
        id: `android-${language}-${Date.now()}`,
        text,
        language,
        speed,
        voice,
      }

      try {
        const spoke = await playTtsRequest(
          {
            router: options.router,
            coordinator: options.coordinator,
            consume: (chunk, signal) => writeChunk(
              resample(chunk.samples, chunk.sampleRateHz, chunk.final), signal, () => { played++ },
            ),
            onProviderError: (error) => options.onProviderError?.({ code: error.code, detail: error.detail }),
          },
          request,
          priority,
        )
        if (spoke && played > 0) {
          // The router prepares the same first eligible backend it spoke with.
          const provider = await options.router.prepare(language, voice)
          report(provider)
          return provider
        }
        if (stopped) return "suppressed"
      } catch (error) {
        if (stopped) return "suppressed"
        options.onProviderError?.({
          detail: `routed TTS failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }

      if (played > 0) {
        const detail = "Speech playback failed after partial PCM; system replay suppressed"
        options.onProviderError?.({ detail })
        report("unavailable", detail)
        return "unavailable"
      }

      // No local neural voice produced audio. If the user opted into the
      // platform-voice fallback, that is what speaks now — reported under its
      // own provider id so it is never mistaken for Pocket.
      if (options.systemVoice?.enabled) {
        const spokeSystemVoice = await options.systemVoice.speak(text, language, {
          priority,
          speed,
          voice,
        })
        if (spokeSystemVoice) {
          if (stopped) return "suppressed"
          report(SYSTEM_TTS_PROVIDER_ID)
          return SYSTEM_TTS_PROVIDER_ID
        }
      }

      // Still nothing to say: report it, never substitute one.
      options.onProviderError?.({ detail: "no local neural voice (Pocket) produced audio" })
      report("unavailable")
      return "unavailable"
    },

    stop() {
      stopped = true
      options.coordinator.stop()
    },
  }
}

/**
 * Linear-interpolation resampler for the PCM hot path.
 *
 * The streaming owner retains the last sample and this function's returned
 * position, so interpolation crosses chunk boundaries without a flat spot.
 */
export function resampleLinear(
  input: Int16Array,
  fromHz: number,
  toHz: number,
  phase = 0,
  final = true,
): { samples: Int16Array; phase: number } {
  if (fromHz === toHz || input.length === 0) return { samples: input, phase }
  const ratio = fromHz / toHz
  const end = input.length - (final ? 0 : 1)
  const outLength = Math.max(0, Math.ceil((end - phase) / ratio))
  const out = new Int16Array(outLength)
  let position = phase
  for (let i = 0; i < outLength; i++) {
    const index = Math.floor(position)
    const fraction = position - index
    const a = input[index] ?? 0
    const b = input[index + 1] ?? a
    out[i] = Math.round(a + (b - a) * fraction)
    position += ratio
  }
  return { samples: out, phase: position - end }
}

/** Retains the last input sample until the following chunk can interpolate it. */
export function createLinearResampler(to: number) {
  let rate: number | undefined
  let tail: number | undefined
  let phase = 0
  return (input: Int16Array, from: number, final: boolean): Int16Array => {
    if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to) || to <= 0) {
      throw new Error("Invalid PCM sample rate")
    }
    if (rate !== undefined && rate !== from) throw new Error("PCM sample rate changed within an utterance")
    rate = from
    if (from === to || (input.length === 0 && tail === undefined)) return input
    const samples = new Int16Array(input.length + (tail === undefined ? 0 : 1))
    if (tail !== undefined) samples[0] = tail
    samples.set(input, tail === undefined ? 0 : 1)
    const result = resampleLinear(samples, from, to, phase, final)
    phase = result.phase
    tail = final ? undefined : samples[samples.length - 1]
    return result.samples
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
