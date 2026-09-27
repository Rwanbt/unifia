/* SPDX-License-Identifier: MIT */
/**
 * Mock TtsRouter — deterministic fallback chain exerciser.
 *
 * Companion to ADR-062 / plan §29 (R8 — TTS routing and manual voice
 * parity). The mock accepts a per-language script of synthesised
 * chunks (or errors) and yields them when `synthesize()` is called.
 *
 * Used by:
 *  - R8 fallback tests (Pocket → Piper → FallbackAndroidTTS)
 *  - R7 Pocket Android adapter parity tests (cross-check 5-language
 *    output against the reference runtime)
 *  - R13 desktop convergence regression suite (cable the router
 *    into voice_host/live/agent.py)
 *
 * The mock honours `AbortSignal` per the lesson recorded on async
 * generators + abort returns silently.
 */

import {
  TTS_LANGUAGES,
  type TtsAudioChunk,
  type TtsCapabilities,
  type TtsConfig,
  type TtsProviderError,
  type TtsProviderId,
  type TtsBackend,
  type TtsRouter,
} from "@unifia/contracts/tts-router"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import { createTtsRouter } from "./tts-router"

/** A scripted response for a single language. */
export interface MockTtsLanguageScript {
  /** Either yield these chunks, or fail. */
  readonly chunks?: readonly Omit<TtsAudioChunk, "generatedAt" | "sequence">[]
  /** Optional mid-stream error to surface to the consumer. */
  readonly error?: { readonly code: string; readonly detail: string; readonly recoverable: boolean }
  /** If set, the first `prepare(language)` call raises this error
   *  and the router walks the fallback chain. */
  readonly prepareFailsWith?: { readonly code: string; readonly detail: string }
}

export interface MockTtsBackendScript {
  readonly id: TtsProviderId
  readonly languages?: readonly ("en" | "fr" | "es" | "it" | "de")[]
  perLanguage: Record<"en" | "fr" | "es" | "it" | "de", MockTtsLanguageScript>
}

/** Build a mock TtsBackend from a script. */
export function createMockTtsBackend(script: MockTtsBackendScript): TtsBackend {
  const languages = script.languages ?? TTS_LANGUAGES
  const capabilities: TtsCapabilities = {
    providerId: script.id,
    languages,
    productionReady: true,
    streaming: true,
    voiceCloning: script.id === "pocket",
    cpuOnly: true,
    // The mock Piper backend models the local isolated process, not
    // a remote TTS endpoint. Remote-capable production providers must
    // be explicitly enabled in TtsRouterOptions.
    remoteCapable: false,
    ttfaMs: script.id === "pocket" ? 180 : script.id === "piper" ? 90 : 320,
    chunkCadenceMs: 60,
  }
  let preparedLanguage: SpeechLanguage = languages[0] ?? "en"
  return {
    id: script.id,
    capabilities,
    async prepare(_config: TtsConfig, signal?: AbortSignal) {
      if (signal?.aborted) throw new Error(`MockTtsBackend(${script.id}).prepare aborted`)
      const langScript = script.perLanguage[_config.language]
      if (langScript?.prepareFailsWith) {
        throw Object.assign(new Error(langScript.prepareFailsWith.detail), {
          code: langScript.prepareFailsWith.code,
        })
      }
      preparedLanguage = _config.language
    },
    async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TtsAudioChunk | TtsProviderError> {
      void text
      const langScript = script.perLanguage[preparedLanguage]
      if (!langScript) {
        yield {
          code: "TTS_LANGUAGE_UNSUPPORTED",
          detail: `No script for ${preparedLanguage}`,
          recoverable: false,
          capturedAt: 0,
        }
        return
      }
      if (langScript.error) {
        yield {
          code: langScript.error.code,
          detail: langScript.error.detail,
          recoverable: langScript.error.recoverable,
          capturedAt: 0,
        }
        if (!langScript.error.recoverable) return
      }
      const chunks = langScript.chunks ?? []
      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) return
        const chunk = chunks[i]
        yield {
          samples: chunk.samples,
          sampleRateHz: chunk.sampleRateHz,
          generatedAt: i * capabilities.chunkCadenceMs,
          sequence: i,
          final: chunk.final ?? i === chunks.length - 1,
        }
      }
    },
    async cancel(_requestId: string) {
      // Mock has no in-flight state to cancel.
    },
    async dispose() {
      // No-op.
    },
  }
}

/** Build a deterministic TtsRouter from a list of mock backends.
 *  The router walks `TTS_DEFAULT_FALLBACK_ORDER` until it finds a
 *  backend whose capabilities cover the requested language. */
export function createMockTtsRouter(backends: readonly TtsBackend[]): TtsRouter {
  return createTtsRouter(backends)
}
