/* SPDX-License-Identifier: MIT */
/**
 * StreamingSttProvider — partial-hypothesis streaming STT contract.
 *
 * Companion to ADR-066 / plan §26 (R5 — Streaming STT bake-off).
 * The Live voice path requires a true streaming STT provider that
 * emits partial hypotheses as audio arrives, with retraction
 * support, final transcripts, confidence and timestamps.
 *
 * The deterministic fingerprint of the streaming contract:
 *   - the provider consumes raw PCM frames (Int16) at the rate the
 *     audio plane produces them (16 kHz, mono, 20 ms frames typical);
 *   - it yields partials as `PartialHypothesis` events with `stable`
 *     set to false — these can still be retracted;
 *   - when the provider is confident a chunk is stable (or when
 *     endpointing policy marks the turn), it yields `PartialHypothesis`
 *     with `stable: true`;
 *   - on turn commit (EOT), it yields a single `FinalTranscript`;
 *   - provider errors mid-stream are surfaced as `ProviderError`
 *     events without aborting the consumer; the consumer decides
 *     whether to fall back to a final-only STT per ADR-066.
 *
 * The interface is platform-neutral: the Android Kotlin/Rust
 * binding and the desktop Python voice-host both implement the
 * same shape, enabling fixture-based parity tests against the R4
 * UNIFIA-EOT-BENCH corpus.
 */

/** Provider identifier — used by the model registry to resolve the
 *  concrete provider instance. */
export type StreamingSttProviderId =
  | "parakeet-tdt-streaming"
  | "moonshine"
  | "nemotron-streaming"
  | "whisper-streaming"
  | "deterministic-mock"

/** Languages the provider claims to support. */
import type { SpeechLanguage } from "./speech.js"

/** PCM frame format the provider consumes. */
export interface PcmFrame {
  /** Mono Int16 samples at `sampleRateHz`. */
  readonly samples: Int16Array
  readonly sampleRateHz: number
  /** Monotonic timestamp (ms) assigned by the audio plane. */
  readonly capturedAt: number
  /** Sequence number assigned by the audio plane. Monotonic per session. */
  readonly sequence: number
}

/** Partial hypothesis emitted while audio is still arriving.
 *  `stable: false` means the provider expects this text to change
 *  (retraction); `stable: true` is locked-in and will not be retracted. */
export interface PartialHypothesis {
  readonly kind: "partial"
  readonly text: string
  readonly stable: boolean
  readonly language: SpeechLanguage
  readonly confidence?: number
  /** Timestamp of the audio frame that produced this partial. */
  readonly capturedAt: number
  /** Sequence number of the last consumed frame. */
  readonly lastSequence: number
}

/** Final transcript emitted once the turn commits (EOT). */
export interface FinalTranscript {
  readonly kind: "final"
  readonly text: string
  readonly language: SpeechLanguage
  readonly confidence?: number
  readonly capturedAt: number
  /** Sequence range consumed for this transcript. */
  readonly fromSequence: number
  readonly toSequence: number
}

/** Provider-side error mid-stream. The consumer decides whether to
 *  continue with a different STT backend, fall back to a final-only
 *  provider, or surface `voice_error stage=stt code=STREAM_*`. */
export interface ProviderError {
  readonly kind: "error"
  readonly code: string
  readonly detail: string
  readonly recovered: boolean
  readonly capturedAt: number
}

/** Discriminated union of every event the streaming STT provider
 *  emits during one turn. */
export type StreamingSttEvent = PartialHypothesis | FinalTranscript | ProviderError

/** Capabilities the provider advertises at startup. The router
 *  selects the appropriate provider per language + profile. */
export interface StreamingSttCapabilities {
  readonly providerId: StreamingSttProviderId
  readonly languages: readonly SpeechLanguage[]
  /** True when the provider emits `stable: true` partials mid-stream;
   *  false when the provider only emits a single final transcript. */
  readonly partials: boolean
  /** True when the provider supports retraction semantics — i.e.
   *  emitted text can be revised across partials. */
  readonly retraction: boolean
  /** Confidence values reported (probabilities in [0, 1]). */
  readonly confidence: boolean
  /** Per-language latency target (warm, ms). */
  readonly partialLatencyMs: number
  readonly finalLatencyMs: number
}

/** Configuration passed to the provider at acquisition. */
export interface StreamingSttConfig {
  readonly language: SpeechLanguage
  /** Optional vocabulary hints that may bias the recognizer. */
  readonly vocabularyHints?: readonly string[]
  /** Maximum wall-clock the provider has between the last frame
   *  and the final transcript. Hard timeout — providers must emit
   *  a FinalTranscript or ProviderError before this elapses. */
  readonly finalTimeoutMs?: number
}

/** Public StreamingSttProvider surface. Mirrors the VAD / TTS
 *  provider contracts: capabilities, prepare, transcribe
 *  (returns the async iterable of streaming events), dispose. */
export interface StreamingSttProvider {
  readonly id: StreamingSttProviderId
  readonly capabilities: StreamingSttCapabilities
  prepare(config: StreamingSttConfig, signal?: AbortSignal): Promise<void>
  /**
   * Stream partial + final transcripts. The async iterable MUST
   * respect `signal` — when aborted, the iterator closes and the
   * provider stops consuming frames (per the lesson learned with
   * async generators + abort signals).
   */
  transcribe(frames: AsyncIterable<PcmFrame>, signal: AbortSignal): AsyncIterable<StreamingSttEvent>
  dispose(): Promise<void>
}

/** Canonical error codes emitted by StreamingSttProvider. */
export const STREAMING_STT_ERROR_CODES = {
  AUDIO_FORMAT_UNSUPPORTED: "STREAM_AUDIO_FORMAT_UNSUPPORTED",
  LANGUAGE_UNSUPPORTED: "STREAM_LANGUAGE_UNSUPPORTED",
  PROVIDER_LOAD_FAILED: "STREAM_PROVIDER_LOAD_FAILED",
  INFERENCE_TIMEOUT: "STREAM_INFERENCE_TIMEOUT",
  MODEL_CRASHED: "STREAM_MODEL_CRASHED",
} as const

export type StreamingSttErrorCode =
  (typeof STREAMING_STT_ERROR_CODES)[keyof typeof STREAMING_STT_ERROR_CODES]
