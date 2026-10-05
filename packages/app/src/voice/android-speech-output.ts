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
import type { TtsAudioChunk, TtsProviderId, TtsRouter } from "@unifia/contracts/tts-router"
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
const MAX_BACKPRESSURE_RETRIES = 40

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
  readonly onProviderError?: (detail: string) => void
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
  // Carried across chunks so a long utterance does not accumulate a
  // fractional-sample offset at every 21.8 ms boundary.
  let resamplePhase = 0
  // `playTtsRequest` resolves true when its stream completes without
  // throwing, which is also true for a router that yielded *no* chunks.
  // Counting consumed PCM is the only honest evidence that a PCM backend
  // actually produced audible audio; without it an empty router would be
  // reported as `pocket` while the device stayed silent.
  let playedChunks = 0

  function report(backend: AndroidSpeechBackendId, detail?: string) {
    lastBackend = backend
    options.onBackendUsed?.(backend, detail)
  }

  /** Push one PCM chunk to the native output, resampling and honouring
   *  ring-buffer backpressure. */
  async function writeChunk(chunk: TtsAudioChunk, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    let resampled: Int16Array
    if (chunk.sampleRateHz === NATIVE_OUTPUT_SAMPLE_RATE_HZ) {
      resampled = chunk.samples
    } else {
      const result = resampleLinear(chunk.samples, chunk.sampleRateHz, NATIVE_OUTPUT_SAMPLE_RATE_HZ, resamplePhase)
      resampled = result.samples
      resamplePhase = result.phase
    }
    if (resampled.length === 0) return
    playedChunks++

    const payload = Array.from(resampled)
    let offset = 0
    for (let attempt = 0; attempt < MAX_BACKPRESSURE_RETRIES; attempt++) {
      if (signal.aborted) return
      const remainder = payload.slice(offset)
      const accepted = await options.invoke("voice_audio_write_pcm", { samples: remainder })
      const written = typeof accepted === "number" ? accepted : remainder.length
      if (written <= 0) {
        await delay(BACKPRESSURE_WAIT_MS)
        continue
      }
      offset += written
      if (offset >= payload.length) return
      await delay(BACKPRESSURE_WAIT_MS)
    }
    if (offset < payload.length) {
      options.onProviderError?.(
        `native playback ring stayed full after ${MAX_BACKPRESSURE_RETRIES} attempts`,
      )
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
      resamplePhase = 0
      playedChunks = 0
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
            consume: writeChunk,
            onProviderError: (error) => options.onProviderError?.(`${error.code}: ${error.detail}`),
          },
          request,
          priority,
        )
        if (spoke && playedChunks > 0) {
          // The router prepares the same first eligible backend it spoke with.
          const provider = await options.router.prepare(language, voice)
          report(provider)
          return provider
        }
        if (stopped) return "suppressed"
      } catch (error) {
        if (stopped) return "suppressed"
        options.onProviderError?.(
          `routed TTS failed before audible audio: ${error instanceof Error ? error.message : String(error)}`,
        )
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
      options.onProviderError?.("no local neural voice (Pocket) produced audio")
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
 * WHY linear and not a windowed-sinc filter: this runs on the Android
 * realtime budget at 22.05k -> 48k. A polyphase FIR costs measurably
 * more CPU per chunk for a conversion whose audible artefact is mild
 * on speech-band content already band-limited by the synthesiser.
 * The resampling ratio is advanced across chunks so long utterances do
 * not accumulate drift.
 */
export function resampleLinear(
  input: Int16Array,
  fromHz: number,
  toHz: number,
  phase = 0,
): { samples: Int16Array; phase: number } {
  if (fromHz === toHz || input.length === 0) return { samples: input, phase }
  const ratio = fromHz / toHz
  const outLength = Math.max(1, Math.floor((input.length - phase) * toHz / fromHz))
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
  return { samples: out, phase: position - Math.floor(position) }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
