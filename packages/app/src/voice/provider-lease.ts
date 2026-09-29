/* SPDX-License-Identifier: MIT */
/**
 * provider-lease.ts — G11 wiring of providers to the resource scheduler.
 *
 * §29: "A model load must acquire a resource lease; a model unload
 * must release it." The scheduler foundation exists in
 * `resource-scheduler.ts` (G11 partial) and the contract lives in
 * `packages/contracts/src/voice-resource-scheduler.ts`. This module
 * is the wiring layer that connects a provider's lifecycle to the
 * lease lifecycle:
 *
 *  - `acquireProviderLease(scheduler, request, signal?)` returns a
 *    `ProviderLeaseHandle` whose `dispose()` releases the lease
 *    synchronously and idempotently.
 *  - `withProviderLease(scheduler, request, fn, signal?)` acquires
 *    the lease, runs `fn`, releases on completion or throw — this
 *    is the safe pattern for one-shot providers (e.g., a single
 *    transcribe() call).
 *  - The handle emits no events of its own; eviction listeners
 *    attached via `scheduler.onEviction(...)` fire when the
 *    scheduler evicts the lease (pressure / TTL / explicit).
 *
 * No-leak invariant: every successful `acquireProviderLease` must
 * be paired with exactly one `dispose()` (or one completed
 * `withProviderLease`). The regression test in `provider-lease.test.ts`
 * asserts this with 1,000-cycle stress + an aborted-acquire path.
 *
 * Hard rule: this module never touches models, audio, or the
 * provider's domain. It only owns the lease lifecycle so the
 * scheduler sees the actual provider residency. The provider itself
 * is responsible for loading / unloading its model on demand; the
 * scheduler observes the residency via leases.
 */

import type {
  ProviderId,
  ResourceId,
  ResourceLease,
  ResourcePriority,
  ResidencyClass,
  VoiceResourceScheduler,
} from "@unifia/contracts/voice-resource-scheduler"

/** Request shape for acquiring a provider lease. Mirrors the
 *  scheduler's `acquire` input but is explicit at the call site so
 *  every wiring point documents its intent. */
export interface ProviderLeaseRequest {
  readonly resource: ResourceId
  readonly owner: ProviderId
  readonly priority: ResourcePriority
  readonly residency: ResidencyClass
  /** Optional explicit TTL — defaults to the scheduler's
   *  `residencyTtlMs` mapping. */
  readonly ttlMs?: number
}

/** Result of a successful acquire. `dispose` releases the lease
 *  synchronously; calling it after the scheduler already evicted the
 *  lease (TTL / pressure) is a no-op. */
export interface ProviderLeaseHandle {
  readonly lease: ResourceLease
  /** Release the lease. Idempotent. */
  dispose(): void
  /** Renew the lease TTL. Throws if the lease was released. */
  renew(ttlMs?: number): number
  /** True when the underlying lease has been released or evicted. */
  readonly released: boolean
}

export function acquireProviderLease(
  scheduler: VoiceResourceScheduler,
  request: ProviderLeaseRequest,
  signal?: AbortSignal,
): ProviderLeaseHandle | undefined {
  const lease = scheduler.acquire({
    resource: request.resource,
    owner: request.owner,
    priority: request.priority,
    residency: request.residency,
    ttlMs: request.ttlMs,
    signal,
  })
  if (!lease) return undefined
  let disposed = false
  const handle: ProviderLeaseHandle = {
    lease,
    renew(ttlMs?: number): number {
      if (disposed) throw new Error(`ProviderLeaseHandle for ${request.resource.kind} is already disposed`)
      return lease.renew(ttlMs)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      lease.release()
    },
    get released(): boolean {
      return disposed || lease.released
    },
  }
  return handle
}

/** Acquire the lease, run `fn`, release on completion or throw.
 *  Returns whatever `fn` returns. If `signal` is aborted before or
 *  during the acquire, the function returns `undefined` and never
 *  runs `fn`. If `signal` aborts while `fn` is running, the caller
 *  is responsible for honoring the abort — this helper does not
 *  cancel `fn`. */
export async function withProviderLease<T>(
  scheduler: VoiceResourceScheduler,
  request: ProviderLeaseRequest,
  fn: (handle: ProviderLeaseHandle) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  const handle = acquireProviderLease(scheduler, request, signal)
  if (!handle) return undefined
  try {
    return await fn(handle)
  } finally {
    handle.dispose()
  }
}

/** Diagnostic snapshot: count leases per owner. Useful for the
 *  no-leak regression test and for diagnostics surfaces. */
export function leaseCountsByOwner(
  scheduler: VoiceResourceScheduler,
): ReadonlyMap<ProviderId, number> {
  const counts = new Map<ProviderId, number>()
  for (const lease of scheduler.list()) {
    counts.set(lease.owner, (counts.get(lease.owner) ?? 0) + 1)
  }
  return counts
}
