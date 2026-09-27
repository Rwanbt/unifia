/* SPDX-License-Identifier: MIT */
/**
 * Canonical Android spoken-output path (G8 / campaign §26).
 *
 * Before this module the Android transport called `AndroidOfflineTts`
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
 * Android system speech is retained only as an explicitly labelled
 * emergency fallback. It is deliberately NOT a `TtsBackend`: the
 * WebView `speechSynthesis` API never yields PCM, so modelling it as a
 * backend would mean the router believed it had a local neural voice.
 * It is reported as `fallback-android-tts` in diagnostics instead of
 * masquerading as `pocket` (ADR-062 §2).
 */

import type {
  SpeechLanguage,
  TtsRequest,
} from "@unifia/contracts/speech"
import type { TtsAudioChunk, TtsRouter } from "@unifia/contracts/tts-router"
import type { AudioPlaybackCoordinator, AudioPlaybackPriority } from "./audio-playback-coordinator"
import type { AndroidOfflineTts } from "./android-offline-tts"
import { playTtsRequest } from "./tts-playback"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/** Which provider actually produced the audible audio. */
export type AndroidSpeechBackendId = "pocket" | "fallback-android-tts" | "suppressed"

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
  /** Explicitly-labelled system-voice emergency path, never a neural backend. */
  readonly emergency: AndroidOfflineTts
  readonly onBackendUsed?: (backend: AndroidSpeechBackendId, detail?: string) => void
  readonly onProviderError?: (detail: string) => void
}

export interface AndroidSpeechOutput {
  /** Warms the router and the emergency voice. Never throws for a missing
   *  neural backend — that is a runtime routing decision, not a start error. */
  prepare(language: SpeechLanguage): Promise<void>
  speak(
    text: string,
    language: SpeechLanguage,
    speed: number,
    priority: AudioPlaybackPriority,
  ): Promise<AndroidSpeechBackendId>
  stop(): void
  /** Backend that produced the most recent audible audio. */
  readonly lastBackend: AndroidSpeechBackendId | undefined
}

export function createAndroidSpeechOutput(
  options: AndroidSpeechOutputOptions,
): AndroidSpeechOutput {
  let lastBackend: AndroidSpeechBackendId | undefined
  let activeEmergency: Promise<void> | undefined
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

  async function speakEmergency(
    text: string,
    language: SpeechLanguage,
    speed: number,
    priority: AudioPlaybackPriority,
  ): Promise<AndroidSpeechBackendId> {
    const controller = new AbortController()
    // Emergency speech owns the same arbitration lease as routed PCM, so a
    // Live turn still preempts it and manual still yields to Live.
    const lease = options.coordinator.acquire(priority, () => {
      controller.abort()
      options.emergency.stop()
    })
    if (!lease) return "suppressed"

    activeEmergency = (async () => {
      await options.emergency.prepare(language)
      if (controller.signal.aborted) return
      await options.emergency.speak(text, language, speed)
    })()

    try {
      await activeEmergency
      return controller.signal.aborted ? "suppressed" : "fallback-android-tts"
    } catch (error) {
      if (controller.signal.aborted) return "suppressed"
      throw error
    } finally {
      options.coordinator.release(lease)
      if (activeEmergency) activeEmergency = undefined
    }
  }

  return {
    get lastBackend() {
      return lastBackend
    },

    async prepare(language) {
      stopped = false
      // A missing or non-production neural backend is not a start failure:
      // the router decides at speak time and falls back honestly.
      await options.router.prepare(language).catch(() => undefined)
    },

    async speak(text, language, speed, priority) {
      stopped = false
      resamplePhase = 0
      playedChunks = 0
      const request: TtsRequest = {
        id: `android-${language}-${Date.now()}`,
        text,
        language,
        speed,
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
          report("pocket")
          return "pocket"
        }
        if (stopped) return "suppressed"
      } catch (error) {
        if (stopped) return "suppressed"
        options.onProviderError?.(
          `routed TTS failed before audible audio: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      // No production PCM backend, or it failed before any audio was heard.
      const backend = await speakEmergency(text, language, speed, priority)
      if (backend === "fallback-android-tts") report(backend)
      return backend
    },

    stop() {
      stopped = true
      options.coordinator.stop()
      options.emergency.stop()
      activeEmergency = undefined
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
