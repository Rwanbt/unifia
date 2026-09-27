/* SPDX-License-Identifier: MIT */
/**
 * Honest final-only StreamingSttProvider — campaign §20: "If no
 * streaming candidate passes Android resource limits: do NOT fake
 * streaming. Keep the interface and use the best honest final-STT
 * fallback while continuing optimization."
 *
 * The provider buffers the committed turn and performs exactly one
 * final transcription through an injected runtime (local Parakeet TDT
 * INT8 on Android, the pinned desktop reference elsewhere). It
 * advertises `capabilities.partials === false`, so consumers and
 * diagnostics can never mistake it for a streaming provider — no
 * fabricated partials, no interpolation, no cloud escape.
 */

import { speechLanguages, type SpeechLanguage } from "@unifia/contracts/speech"
import {
  STREAMING_STT_ERROR_CODES,
  type StreamingSttCapabilities,
  type StreamingSttConfig,
  type StreamingSttEvent,
  type StreamingSttProvider,
  type StreamingSttProviderId,
} from "@unifia/contracts/streaming-stt"
import { createPcmBuffer, PCM_TURN_SECONDS } from "./pcm-buffer"
import { fault, last } from "./stt-events"
import { codeOf, messageOf, raised } from "./stt-errors"

const { AUDIO_FORMAT_UNSUPPORTED, LANGUAGE_UNSUPPORTED, PROVIDER_LOAD_FAILED, TRANSCRIPTION_FAILED } =
  STREAMING_STT_ERROR_CODES

/** Audio handed to the injected final STT. */
export interface FinalAudio {
  readonly samples: Int16Array
  readonly sampleRateHz: number
}

export interface FinalSttDeps {
  /** Injected final/batch transcription (e.g. local Parakeet TDT INT8). */
  transcribe(audio: FinalAudio, config: StreamingSttConfig, signal: AbortSignal): Promise<string>
  /** Defaults to the contract's honest final-only identifier. */
  readonly providerId?: StreamingSttProviderId
  readonly languages?: readonly SpeechLanguage[]
  readonly finalLatencyMs?: number
}

export function createFinalSttFallbackProvider(deps: FinalSttDeps): StreamingSttProvider {
  const providerId = deps.providerId ?? "parakeet-tdt-final"
  const languages = deps.languages ?? speechLanguages
  const capabilities: StreamingSttCapabilities = {
    providerId,
    languages,
    partials: false,
    retraction: false,
    confidence: false,
    partialLatencyMs: 0,
    finalLatencyMs: deps.finalLatencyMs ?? 400,
  }
  let cfg: StreamingSttConfig | undefined

  return {
    id: providerId,
    capabilities,
    async prepare(next, signal) {
      if (signal?.aborted) throw raised(PROVIDER_LOAD_FAILED, "final STT fallback: prepare aborted")
      if (!languages.includes(next.language)) {
        throw raised(LANGUAGE_UNSUPPORTED, `final STT fallback does not offer "${next.language}"`)
      }
      cfg = next
    },
    async *transcribe(frames, signal): AsyncGenerator<StreamingSttEvent> {
      const active = cfg
      if (!active) throw new Error("final STT fallback: prepare() must run before transcribe()")
      if (signal.aborted) return
      // WHY 192 kHz: every plausible capture device stays below it, so
      // a never-ending frame source is bounded (~23 MB) without ever
      // dropping audio from a legitimate <= 60 s turn.
      const pcm = createPcmBuffer(192_000 * PCM_TURN_SECONDS)
      let rate = 0
      let count = 0
      let from = -1
      let to = -1
      let at = 0
      for await (const frame of frames) {
        if (signal.aborted) return
        if (frame.samples.length === 0) continue
        if (!rate) rate = frame.sampleRateHz
        if (frame.sampleRateHz !== rate) {
          yield fault(
            AUDIO_FORMAT_UNSUPPORTED,
            `mixed sample rates in one turn: ${rate} then ${frame.sampleRateHz} Hz`,
            frame.capturedAt,
          )
          return
        }
        pcm.push(frame.samples)
        count += frame.samples.length
        if (from < 0) from = frame.sequence
        to = frame.sequence
        at = frame.capturedAt
      }
      if (signal.aborted) return
      if (!count) {
        yield last("", active.language, at, 0, 0)
        return
      }
      let text = ""
      try {
        text = (
          await deps.transcribe({ samples: pcm.concat(), sampleRateHz: rate }, active, signal)
        ).trim()
      } catch (error) {
        if (signal.aborted) return
        yield fault(codeOf(error, TRANSCRIPTION_FAILED), messageOf(error), at)
        return
      }
      if (signal.aborted) return
      yield last(text, active.language, at, from, to)
    },
    async dispose() {
      // No resources held — the injected runtime owns its own lifetime.
    },
  }
}
