/* SPDX-License-Identifier: MIT */
/**
 * TtsBackend + TtsRouter — canonical TTS routing contract.
 *
 * Companion to ADR-062 / ADR-074 / plan §29 (R8 — TTS routing
 * and manual voice parity). The canonical path is:
 *
 *   Pocket → validated local fallback → explicit error
 *
 * No silent cloud fallback (per ADR-062 §2). Desktop Piper remains
 * an isolated external-process provider (legal/process boundary per
 * ADR-058 §15.5). Mobile APK must NOT embed the active GPL Piper
 * runtime — only the Pocket multilingual weights run inside the MIT
 * mobile binary, with `PocketTTS.cpp` as the primary Android
 * adapter per ADR-059 §"Pocket Android Runtime".
 */

import type { SpeechLanguage } from "./speech.js"

/** TTS provider identifier — used by the registry to pick the
 *  concrete implementation. */
export type TtsProviderId = "pocket" | "piper" | "fallback-android-tts"

/** Stable list of mandatory production languages (v2 plan §7). */
export const TTS_LANGUAGES: readonly SpeechLanguage[] = [
  "en",
  "fr",
  "es",
  "it",
  "de",
] as const

/** A single chunk of synthesised PCM audio. The router forwards
 *  chunks in order to the playback adapter; the consumer is
 *  responsible for sample-rate conversion if needed. */
export interface TtsAudioChunk {
  /** Mono Int16 samples at `sampleRateHz`. */
  readonly samples: Int16Array
  readonly sampleRateHz: number
  /** Monotonic timestamp (ms) at which the chunk was generated. */
  readonly generatedAt: number
  /** Sequence number assigned by the TTS provider; monotonic per
   *  `synthesize` call. */
  readonly sequence: number
  /** True for the last chunk of an utterance — the consumer may
   *  flush its buffer once the chunk is consumed. */
  readonly final: boolean
}

/** Provider-side error mid-utterance. The router decides whether to
 *  fall back to the next provider per ADR-062. */
export interface TtsProviderError {
  readonly code: string
  readonly detail: string
  readonly recoverable: boolean
  readonly capturedAt: number
}

/** Capabilities advertised at provider acquisition. The router
 *  uses these to pick the best provider per language + profile. */
export interface TtsCapabilities {
  readonly providerId: TtsProviderId
  readonly languages: readonly SpeechLanguage[]
  readonly streaming: boolean
  readonly voiceCloning: boolean
  readonly cpuOnly: boolean
  readonly remoteCapable: boolean
  /** Warm time-to-first-audio target (ms) per language. */
  readonly ttfaMs: number
  /** Streaming chunk cadence (ms). */
  readonly chunkCadenceMs: number
}

/** Configuration passed to the provider at `prepare`. */
export interface TtsConfig {
  readonly language: SpeechLanguage
  readonly voice?: string
  readonly speed: number
  /** Optional voice-cloning conditioning sample (managed path only). */
  readonly voiceClonePath?: string
}

/** Public TtsBackend surface. Mirrors the VAD / STT contracts:
 *  capabilities, prepare, synthesize (async iterable of chunks),
 *  cancel, dispose. */
export interface TtsBackend {
  readonly id: TtsProviderId
  readonly capabilities: TtsCapabilities
  prepare(config: TtsConfig, signal?: AbortSignal): Promise<void>
  /**
   * Stream synthesised audio chunks. The async iterable MUST
   * respect `signal` — when aborted, the iterator closes and the
   * provider stops producing chunks (per the lesson on async
   * generators + abort signals).
   */
  synthesize(text: string, signal: AbortSignal): AsyncIterable<TtsAudioChunk | TtsProviderError>
  /** Cancel an in-flight utterance. Idempotent. */
  cancel(requestId: string): Promise<void>
  /** Release provider resources. */
  dispose(): Promise<void>
}

/** Canonical error codes for TtsBackend implementations. */
export const TTS_ERROR_CODES = {
  LANGUAGE_UNSUPPORTED: "TTS_LANGUAGE_UNSUPPORTED",
  MODEL_MISSING: "TTS_MODEL_MISSING",
  MODEL_LOAD_FAILED: "TTS_MODEL_LOAD_FAILED",
  MODEL_INTEGRITY_FAILED: "TTS_MODEL_INTEGRITY_FAILED",
  PROVIDER_OFFLINE: "TTS_PROVIDER_OFFLINE",
  STREAMING_CANCELLED: "TTS_STREAMING_CANCELLED",
  CONTENT_POLICY_BLOCKED: "TTS_CONTENT_POLICY_BLOCKED",
} as const

export type TtsErrorCode = (typeof TTS_ERROR_CODES)[keyof typeof TTS_ERROR_CODES]

/**
 * The TtsRouter selects a backend per (language, profile), handles
 * fallback when the primary provider fails, and refuses silent
 * cloud redirects.
 *
 * Nominal path (R8 / ADR-062 §2):
 *   Pocket → validated local fallback → explicit error
 */
export interface TtsRouter {
  readonly voices: import("./speech.js").VoiceRegistry
  /** Resolve which provider id should handle a given language. */
  prepare(language: SpeechLanguage, signal?: AbortSignal): Promise<TtsProviderId>
  /** Stream audio for a text request. Cancels and falls back to
   *  the next provider on recoverable errors. Throws on
   *  non-recoverable exhaustion. */
  synthesize(request: import("./speech.js").TtsRequest, signal: AbortSignal): AsyncIterable<TtsAudioChunk | TtsProviderError>
  /** Cancel an in-flight utterance by request id. */
  cancel(requestId: string): Promise<void>
  /** Release all provider resources. */
  dispose(): Promise<void>
}

/** Default fallback order (most preferred first). The router walks
 *  this list and stops at the first provider whose capabilities
 *  cover the requested language. */
export const TTS_DEFAULT_FALLBACK_ORDER: readonly TtsProviderId[] = [
  "pocket",
  "piper",
  "fallback-android-tts",
] as const
