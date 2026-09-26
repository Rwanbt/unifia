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
  TTS_DEFAULT_FALLBACK_ORDER,
  TTS_LANGUAGES,
  type TtsAudioChunk,
  type TtsCapabilities,
  type TtsConfig,
  type TtsProviderError,
  type TtsProviderId,
  type TtsBackend,
  type TtsRouter,
} from "@unifia/contracts/tts-router"
import type { TtsRequest } from "@unifia/contracts/speech"

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
    streaming: true,
    voiceCloning: script.id === "pocket",
    cpuOnly: true,
    remoteCapable: script.id === "piper",
    ttfaMs: script.id === "pocket" ? 180 : script.id === "piper" ? 90 : 320,
    chunkCadenceMs: 60,
  }
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
    },
    async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TtsAudioChunk | TtsProviderError> {
      // Pick the language from the request by name match — the mock
      // doesn't take a config because the router passes the language
      // through `request.language`. For tests we infer language from
      // text prefix, but a real router would pass config explicitly.
      void text
      // Use the first configured language as a fallback for tests
      // that don't pin language.
      const language = script.languages?.[0] ?? "en"
      const langScript = script.perLanguage[language]
      if (!langScript) {
        yield {
          code: "TTS_LANGUAGE_UNSUPPORTED",
          detail: `No script for ${language}`,
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
  const index = new Map<TtsProviderId, TtsBackend>()
  for (const backend of backends) index.set(backend.id, backend)
  const voices = {
    list: () => [],
    get: () => undefined,
  }
  return {
    voices,
    async prepare(language, signal) {
      for (const id of TTS_DEFAULT_FALLBACK_ORDER) {
        const backend = index.get(id)
        if (!backend) continue
        if (!backend.capabilities.languages.includes(language)) continue
        try {
          await backend.prepare({ language, speed: 1.0 }, signal)
          return id
        } catch (error) {
          const code = (error as { code?: string }).code
          // Recoverable prepare failure — try next provider.
          if (code === "TTS_MODEL_LOAD_FAILED" || code === "TTS_MODEL_INTEGRITY_FAILED") continue
          // Non-recoverable — surface immediately.
          throw error
        }
      }
      throw new Error(`TtsRouter: no backend covers language ${language}`)
    },
    synthesize(request: TtsRequest, signal: AbortSignal): AsyncIterable<TtsAudioChunk | TtsProviderError> {
      async function* gen(): AsyncIterable<TtsAudioChunk | TtsProviderError> {
        let lastError: TtsProviderError | undefined
        outer: for (const id of TTS_DEFAULT_FALLBACK_ORDER) {
          const backend = index.get(id)
          if (!backend) continue
          if (!backend.capabilities.languages.includes(request.language)) continue
          // ADR-062 §"Never restart an utterance that already started playing":
          // once a provider has emitted at least one audio chunk for this
          // request, we MUST NOT fall back to another provider — switching
          // mid-utterance would re-speak the same text. Track per-provider
          // emission so a mid-stream error can fall back only when no
          // audio was produced yet.
          let emittedAudio = false
          for await (const event of backend.synthesize(request.text, signal)) {
            if (event && "code" in event) {
              lastError = event
              if (event.recoverable && !emittedAudio) {
                // Recoverable mid-stream error BEFORE any audio — yield
                // the error to the consumer so the failure is visible
                // (logging, metrics, voice_error surfacing), then hand
                // off to the next provider in TTS_DEFAULT_FALLBACK_ORDER.
                yield event
                continue outer
              }
              // Non-recoverable, or recoverable after audio already
              // started → ADR-062 forbids restarting the utterance.
              yield event
              return
            }
            emittedAudio = true
            yield event
          }
          return // primary path completed successfully
        }
        if (lastError) {
          yield lastError
          return
        }
        throw new Error(`TtsRouter: no backend covers language ${request.language}`)
      }
      return gen()
    },
    async cancel(requestId: string) {
      for (const backend of backends) {
        await backend.cancel(requestId).catch(() => undefined)
      }
    },
    async dispose() {
      for (const backend of backends) {
        await backend.dispose().catch(() => undefined)
      }
    },
  }
}
