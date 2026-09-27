/* SPDX-License-Identifier: MIT */
import { createVoiceRegistry, type TtsRequest, type VoiceManifest } from "@unifia/contracts/speech"
import {
  TTS_DEFAULT_FALLBACK_ORDER,
  TTS_ERROR_CODES,
  type TtsAudioChunk,
  type TtsBackend,
  type TtsProviderError,
  type TtsProviderId,
  type TtsRouter,
} from "@unifia/contracts/tts-router"

const RECOVERABLE_CODES = new Set<string>([
  TTS_ERROR_CODES.MODEL_MISSING,
  TTS_ERROR_CODES.MODEL_LOAD_FAILED,
  TTS_ERROR_CODES.MODEL_INTEGRITY_FAILED,
  TTS_ERROR_CODES.PROVIDER_OFFLINE,
])
const CANONICAL_CODES = new Set<string>(Object.values(TTS_ERROR_CODES))

export interface TtsRouterOptions {
  /** Override the contract fallback order for product-specific local
   *  profiles. Every ID must still be a known TTS provider ID. */
  readonly fallbackOrder?: readonly TtsProviderId[]
  /** Remote-capable providers are excluded unless explicitly named.
   *  This defaults to no remote providers, preventing silent cloud TTS. */
  readonly allowRemoteProviders?: readonly TtsProviderId[]
  readonly voices?: readonly VoiceManifest[]
  readonly now?: () => number
}

/** Production TTS router. Backends are injected platform adapters;
 *  routing policy, readiness checks, fallback classification, and
 *  cancellation are owned here rather than in test mocks. */
export function createTtsRouter(backends: readonly TtsBackend[], options: TtsRouterOptions = {}): TtsRouter {
  const index = new Map<TtsProviderId, TtsBackend>()
  for (const backend of backends) {
    if (index.has(backend.id)) throw new Error(`TtsRouter: duplicate backend id ${backend.id}`)
    index.set(backend.id, backend)
  }

  const order = options.fallbackOrder ?? TTS_DEFAULT_FALLBACK_ORDER
  const remoteAllowed = new Set(options.allowRemoteProviders ?? [])
  const now = options.now ?? Date.now
  const voices = createVoiceRegistry(options.voices ?? [])

  function eligible(language: TtsRequest["language"]): TtsBackend[] {
    return order.flatMap((id) => {
      const backend = index.get(id)
      if (!backend || !backend.capabilities.languages.includes(language)) return []
      if (backend.capabilities.productionReady === false) return []
      if (backend.capabilities.remoteCapable && !remoteAllowed.has(id)) return []
      return [backend]
    })
  }

  function failure(error: unknown, provider: TtsProviderId, detail = "TTS provider failed"): TtsProviderError {
    const candidate = (error as { code?: unknown } | null | undefined)?.code
    const code = typeof candidate === "string" && CANONICAL_CODES.has(candidate)
      ? candidate
      : TTS_ERROR_CODES.MODEL_LOAD_FAILED
    const errorDetail = error instanceof Error ? error.message : detail
    return {
      code,
      detail: `${provider}: ${errorDetail}`,
      recoverable: RECOVERABLE_CODES.has(code),
      capturedAt: now(),
    }
  }

  async function prepareBackend(backend: TtsBackend, request: TtsRequest, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw Object.assign(new Error("TTS prepare aborted"), { code: TTS_ERROR_CODES.STREAMING_CANCELLED })
    await backend.prepare(
      { language: request.language, voice: request.voice, speed: request.speed },
      signal,
    )
  }

  return {
    voices,

    async prepare(language, signal) {
      for (const backend of eligible(language)) {
        try {
          await prepareBackend(backend, { id: "tts-prepare", text: "", language, speed: 1 }, signal)
          return backend.id
        } catch (error) {
          const providerError = failure(error, backend.id)
          if (signal?.aborted) throw Object.assign(new Error("TTS prepare cancelled"), { code: TTS_ERROR_CODES.STREAMING_CANCELLED })
          if (providerError.recoverable) continue
          throw Object.assign(new Error(providerError.detail), { code: providerError.code })
        }
      }
      throw Object.assign(
        new Error(`TtsRouter: no production-ready local backend covers ${language}`),
        { code: TTS_ERROR_CODES.PROVIDER_OFFLINE },
      )
    },

    synthesize(request, signal): AsyncIterable<TtsAudioChunk | TtsProviderError> {
      async function* route(): AsyncGenerator<TtsAudioChunk | TtsProviderError> {
        const candidates = eligible(request.language)
        if (candidates.length === 0) {
          yield {
            code: TTS_ERROR_CODES.PROVIDER_OFFLINE,
            detail: `No production-ready local TTS backend covers ${request.language}`,
            recoverable: false,
            capturedAt: now(),
          }
          return
        }

        let lastFailure: TtsProviderError | undefined
        providerLoop: for (const backend of candidates) {
          if (signal.aborted) return
          try {
            await prepareBackend(backend, request, signal)
          } catch (error) {
            if (signal.aborted) return
            lastFailure = failure(error, backend.id)
            yield lastFailure
            if (lastFailure.recoverable) continue
            return
          }

          let emitted = false
          let sawFinal = false
          try {
            for await (const event of backend.synthesize(request.text, signal)) {
              if (signal.aborted) return
              if ("code" in event) {
                lastFailure = {
                  code: CANONICAL_CODES.has(event.code) ? event.code : TTS_ERROR_CODES.MODEL_LOAD_FAILED,
                  detail: event.detail,
                  recoverable:
                    CANONICAL_CODES.has(event.code) && RECOVERABLE_CODES.has(event.code),
                  capturedAt: event.capturedAt,
                }
                yield lastFailure
                if (lastFailure.recoverable && !emitted) continue providerLoop
                return
              }
              emitted = true
              sawFinal ||= event.final
              yield event
              if (event.final) return
            }
          } catch (error) {
            if (signal.aborted) return
            lastFailure = failure(error, backend.id)
            // Once audio was emitted, restarting would speak the same
            // utterance twice. Make the failure terminal for this request.
            if (emitted) {
              yield { ...lastFailure, recoverable: false }
              return
            }
            yield lastFailure
            if (lastFailure.recoverable) continue
            return
          }

          if (signal.aborted) return
          if (!sawFinal) {
            lastFailure = {
              code: TTS_ERROR_CODES.MODEL_LOAD_FAILED,
              detail: `${backend.id}: synthesis ended without a final audio chunk`,
              recoverable: !emitted,
              capturedAt: now(),
            }
            yield lastFailure
            if (lastFailure.recoverable) continue
            return
          }
        }

        if (lastFailure) {
          yield {
            code: TTS_ERROR_CODES.PROVIDER_OFFLINE,
            detail: `No local TTS provider completed ${request.id}; last failure: ${lastFailure.code}`,
            recoverable: false,
            capturedAt: now(),
          }
          return
        }
        yield {
          code: TTS_ERROR_CODES.PROVIDER_OFFLINE,
          detail: `No local TTS backend completed ${request.id}`,
          recoverable: false,
          capturedAt: now(),
        }
      }
      return route()
    },

    async cancel(requestId) {
      const results = await Promise.allSettled(backends.map((backend) => backend.cancel(requestId)))
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
      if (failures.length) throw new AggregateError(failures, `TtsRouter: cancellation failed for ${requestId}`)
    },

    async dispose() {
      const results = await Promise.allSettled(backends.map((backend) => backend.dispose()))
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
      if (failures.length) throw new AggregateError(failures, "TtsRouter: backend disposal failed")
    },
  }
}
