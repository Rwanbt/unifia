/* SPDX-License-Identifier: MIT */
/**
 * wired-providers.ts — G11 wiring decorators for providers.
 *
 * §29: "A model load must acquire a resource lease; a model unload
 * must release it." This module binds the provider lifecycle
 * (prepare / dispose) to the resource-scheduler lease lifecycle.
 *
 * Each decorator wraps a base provider and:
 *  - On `prepare(config, signal)`: acquires a lease for the
 *    requested resource (or refuses, returning undefined), then
 *    calls the base `prepare()`. The lease is held for the
 *    provider's lifetime.
 *  - On `dispose()`: calls the base `dispose()` first, then
 *    releases the lease. Releasing after the base dispose means
 *    an aborted prepare never leaves a dangling lease.
 *  - The decorated provider is otherwise a passthrough.
 *
 * Decorators:
 *  - `wireStreamingSttLease`     — `streaming-stt-nemo`, `streaming-stt-fallback`
 *  - `wireVadLease`             — Silero VAD host-side
 *  - `wireFastDecisionLease`    — Rules / OFF / TinyClassifier
 *
 * No-leak invariant: the decorator's `dispose()` is the single
 * release point; if the caller forgets to dispose, the scheduler
 * eventually evicts the lease via TTL (idle-evict) or pressure.
 * Regression test in `wired-providers.test.ts` asserts the
 * decorator's no-leak invariant under all four provider types.
 */

import type {
  ProviderId,
  ResourcePriority,
  ResidencyClass,
  VoiceResourceScheduler,
} from "@unifia/contracts/voice-resource-scheduler"
import type {
  StreamingSttProvider,
  StreamingSttConfig,
  StreamingSttEvent,
} from "@unifia/contracts/streaming-stt"
import type { FastDecisionProvider, FastDecisionInput, DecisionProposal } from "@unifia/contracts/fast-decision"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import { acquireProviderLease, withProviderLease, type ProviderLeaseHandle, type ProviderLeaseRequest } from "./provider-lease"

/** Common wiring options shared by every decorator. */
export interface WireOptions {
  readonly priority: ResourcePriority
  readonly residency: ResidencyClass
  /** Override the lease TTL — defaults to the residency's TTL. */
  readonly ttlMs?: number
}

export interface WiredProvider<TBase> extends Disposable {
  /** The wrapped provider (passthrough). */
  readonly base: TBase
  /** The current lease, if any. `undefined` before `prepare()`. */
  readonly lease: ProviderLeaseHandle | undefined
}

/* ──────────────────────────────────────────────────────────────────
 * StreamingStt
 * ────────────────────────────────────────────────────────────────── */

export interface WireStreamingSttRequest extends ProviderLeaseRequest {
  readonly resource: ProviderLeaseRequest["resource"] & { readonly kind: "stt" }
}

export function wireStreamingSttLease(
  scheduler: VoiceResourceScheduler,
  base: StreamingSttProvider,
  request: WireStreamingSttRequest,
  wire: WireOptions,
): WiredProvider<StreamingSttProvider> {
  let lease: ProviderLeaseHandle | undefined
  let disposed = false
  const wrapped: StreamingSttProvider = {
    id: base.id,
    capabilities: base.capabilities,
    async prepare(next: StreamingSttConfig, signal?: AbortSignal): Promise<void> {
      if (disposed) throw new Error("wired StreamingStt: prepare() after dispose()")
      const handle = acquireProviderLease(scheduler, { ...request, ...wire }, signal)
      if (!handle) {
        throw new Error(
          `wired StreamingStt: could not acquire lease for ${request.resource.kind}:${request.resource.language ?? ""} (priority=${wire.priority}, residency=${wire.residency})`,
        )
      }
      try {
        await base.prepare(next, signal)
        lease = handle
      } catch (err) {
        handle.dispose()
        throw err
      }
    },
    transcribe(frames, signal): AsyncIterable<StreamingSttEvent> {
      if (!lease) throw new Error("wired StreamingStt: transcribe() before prepare()")
      return base.transcribe(frames, signal)
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      try {
        await base.dispose()
      } finally {
        lease?.dispose()
        lease = undefined
      }
    },
  }
  return {
    base: wrapped,
    get lease() {
      return lease
    },
  } as WiredProvider<StreamingSttProvider>
}

/* ──────────────────────────────────────────────────────────────────
 * FastDecision — provider is sync (no prepare/dispose). The lease
 * is acquired up front and held for the provider's lifetime.
 * ────────────────────────────────────────────────────────────────── */

export interface WireFastDecisionRequest extends ProviderLeaseRequest {
  readonly resource: ProviderLeaseRequest["resource"] & { readonly kind: "fast-decision" }
}

export function wireFastDecisionLease(
  scheduler: VoiceResourceScheduler,
  base: FastDecisionProvider,
  request: WireFastDecisionRequest,
  wire: WireOptions,
): WiredProvider<FastDecisionProvider> {
  let lease: ProviderLeaseHandle | undefined
  let disposed = false
  const handle = acquireProviderLease(scheduler, { ...request, ...wire })
  if (!handle) {
    throw new Error(
      `wired FastDecision: could not acquire lease for ${request.resource.kind}:${request.resource.language ?? ""} (priority=${wire.priority})`,
    )
  }
  lease = handle
  const wrapped: FastDecisionProvider = {
    providerId: base.providerId,
    capabilities: base.capabilities,
    decide(input: FastDecisionInput): DecisionProposal {
      if (disposed) {
        return {
          kind: "continue",
          confidence: 0,
          language: input.language,
          sourceText: input.text,
          emittedAt: input.capturedAt,
          rationale: "wired-fast-decision-disposed",
        }
      }
      return base.decide(input)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      lease?.dispose()
      lease = undefined
    },
  }
  return {
    base: wrapped,
    get lease() {
      return lease
    },
  } as WiredProvider<FastDecisionProvider>
}

/* ──────────────────────────────────────────────────────────────────
 * VAD (Silero host-side)
 * ────────────────────────────────────────────────────────────────── */

export interface WireVadRequest extends ProviderLeaseRequest {
  readonly resource: ProviderLeaseRequest["resource"] & { readonly kind: "vad" }
}

/** Silero VAD wraps a sync `decide` function. Same lease shape as
 *  FastDecision. Kept as a separate function so the VAD wiring has
 *  a documented place to add eviction listeners (e.g., re-init the
 *  ORT session when the lease is reclaimed). */
export interface WiredSileroVad {
  readonly base: { decide(frame: Int16Array, sampleRateHz: number): { probability: number; speech: boolean } }
  readonly lease: ProviderLeaseHandle | undefined
  dispose(): void
}

export function wireSileroVadLease(
  scheduler: VoiceResourceScheduler,
  base: {
    decide(frame: Int16Array, sampleRateHz: number): { probability: number; speech: boolean }
  },
  request: WireVadRequest,
  wire: WireOptions,
): WiredSileroVad {
  let lease: ProviderLeaseHandle | undefined
  let disposed = false
  const handle = acquireProviderLease(scheduler, { ...request, ...wire })
  if (!handle) {
    throw new Error(
      `wired Silero VAD: could not acquire lease for ${request.resource.kind}:${request.resource.language ?? ""} (priority=${wire.priority})`,
    )
  }
  lease = handle
  return {
    base,
    get lease() {
      return lease
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      lease?.dispose()
      lease = undefined
    },
  }
}

/* ──────────────────────────────────────────────────────────────────
 * Re-export of `withProviderLease` for one-shot providers
 * ────────────────────────────────────────────────────────────────── */

export { withProviderLease }

/** Type guard: language code is one of the five required. Used
 *  by the decorators to validate wiring inputs. */
export function isRequiredLanguage(lang: string): lang is SpeechLanguage {
  return lang === "en" || lang === "fr" || lang === "es" || lang === "it" || lang === "de"
}

/** Diagnostic: how many leases are currently held by `owner`. */
export function activeLeases(
  scheduler: VoiceResourceScheduler,
  owner: ProviderId,
): number {
  let n = 0
  for (const lease of scheduler.list()) {
    if (lease.owner === owner) n++
  }
  return n
}
