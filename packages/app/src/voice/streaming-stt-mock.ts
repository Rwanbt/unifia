/* SPDX-License-Identifier: MIT */
/**
 * Deterministic mock StreamingSttProvider — used for tests and for
 * the UNIFIA-EOT-BENCH consumer pipeline (ADR-066 / R5).
 *
 * The mock accepts a deterministic sequence of events per fixture
 * and yields them in order when `transcribe()` is called. Tests
 * can use it to assert that:
 *  - partials are emitted with `stable: false` and retractions
 *    propagate correctly;
 *  - `stable: true` partials are locked in;
 *  - exactly one FinalTranscript is emitted per turn;
 *  - ProviderError events do not abort the consumer;
 *  - AbortSignal is honoured (per the lesson recorded on
 *    async generator + abort signal returns silently).
 */

import {
  STREAMING_STT_ERROR_CODES,
  type FinalTranscript,
  type PcmFrame,
  type ProviderError,
  type StreamingSttCapabilities,
  type StreamingSttConfig,
  type StreamingSttEvent,
  type PartialHypothesis,
  type StreamingSttProvider,
  type StreamingSttProviderId,
} from "@unifia/contracts/streaming-stt"

/** A canned sequence of events the mock will replay. */
export interface MockSttScript {
  readonly id: StreamingSttProviderId
  readonly languages: readonly ("en" | "fr" | "es" | "it" | "de")[]
  readonly script: readonly StreamingSttEvent[]
  /** Optional per-frame delay (ms) to simulate streaming latency. */
  readonly perFrameDelayMs?: number
}

/** Build a deterministic mock provider from a script. The script
 *  is replayed verbatim on each `transcribe` call. */
export function createMockStreamingSttProvider(script: MockSttScript): StreamingSttProvider {
  const capabilities: StreamingSttCapabilities = {
    providerId: script.id,
    languages: script.languages,
    partials: script.script.some((e) => e.kind === "partial"),
    retraction: true,
    confidence: script.script.every((e) => e.kind !== "partial" || typeof e.confidence === "number"),
    partialLatencyMs: script.perFrameDelayMs ?? 50,
    finalLatencyMs: 200,
  }
  return {
    id: script.id,
    capabilities,
    async prepare(_config: StreamingSttConfig, _signal?: AbortSignal) {
      // Mock provider has no resources to load — but still honour the
      // abort signal so the contract is testable.
      if (_signal?.aborted) {
        throw new Error("MockStreamingSttProvider.prepare aborted")
      }
    },
    async *transcribe(frames: AsyncIterable<PcmFrame>, signal: AbortSignal): AsyncIterable<StreamingSttEvent> {
      // Drain the frame iterator to keep the producer alive (mirrors
      // how a real provider would consume PCM). We do not use the
      // frames for content, but we DO check the signal between
      // yields so an aborted consumer doesn't see stale partials.
      const drain = (async () => {
        for await (const _frame of frames) {
          if (signal.aborted) return
        }
      })()
      try {
        for (const event of script.script) {
          if (signal.aborted) return
          if (script.perFrameDelayMs && script.perFrameDelayMs > 0) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, script.perFrameDelayMs)
              signal.addEventListener("abort", () => {
                clearTimeout(timer)
                resolve()
              })
            })
            if (signal.aborted) return
          }
          yield event
        }
      } finally {
        await drain
      }
    },
    async dispose() {
      // No-op for the mock; recorded for API symmetry with real providers.
    },
  }
}

/** Convenience: build a partial-hypothesis event. */
export function partialHypothesis(input: Omit<PartialHypothesis, "kind">): PartialHypothesis {
  return { kind: "partial", ...input }
}

/** Convenience: build a final-transcript event. */
export function finalTranscript(input: Omit<FinalTranscript, "kind">): FinalTranscript {
  return { kind: "final", ...input }
}

/** Convenience: build a provider-error event. */
export function providerError(code: string, detail: string, recovered = false, capturedAt = 0): ProviderError {
  return {
    kind: "error",
    code,
    detail,
    recovered,
    capturedAt,
  }
}

/** Common error code constants re-exported for callers building scripts. */
export const StreamingSttErrorCodes = STREAMING_STT_ERROR_CODES
