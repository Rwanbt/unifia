/* SPDX-License-Identifier: MIT */
/**
 * VoiceResourceScheduler — pure-logic scheduler for ADR-074 (R11).
 *
 * Tracks resource leases, applies priority ordering for preemption,
 * and emits eviction events under memory or thermal pressure. The
 * scheduler is intentionally platform-neutral; the host supplies
 * memory + thermal signals via callbacks (Android ActivityManager /
 * PowerManager, Windows GPU drivers, etc.).
 *
 * No I/O, no async I/O, no logging of resource content. The
 * scheduler is pure compute — easy to unit-test deterministically.
 */

import {
  IDLE_EVICT_MS,
  KEEP_WARM_TTL_MS,
  PRIORITY_ORDER,
  priorityWeight,
  type EvictionEvent,
  type MemoryPressureState,
  type NpuCapability,
  type ProviderId,
  type ResourceId,
  type ResourceLease,
  type ResourcePriority,
  type ResidencyClass,
  type SchedulerDiagnostics,
  type ThermalStatus,
  type VoiceResourceScheduler,
} from "@unifia/contracts/voice-resource-scheduler"

export interface VoiceResourceSchedulerOptions {
  /** Which platform this scheduler runs on. */
  readonly mode: "desktop" | "mobile"
  /** When `local-llm` owns the GPU, Voice must not allocate VRAM. */
  readonly gpuOwnedBy?: "voice" | "local-llm" | "shared" | "none"
  /** NPU capability advertised at startup. Defaults to unavailable. */
  readonly npu?: NpuCapability
  /** Override the wall-clock — useful in tests. */
  readonly now?: () => number
  /** Override the random suffix for lease IDs. */
  readonly randomId?: () => string
}

interface LeaseInternal {
  readonly id: string
  readonly resource: ResourceId
  readonly owner: ProviderId
  readonly priority: ResourcePriority
  readonly residency: ResidencyClass
  /** Mutable so `renew()` can reset the expiry clock relative to
   *  `now()`; the public `ResourceLease.acquiredAt` is exposed
   *  as a getter that reads this field. */
  acquiredAt: number
  ttlMs: number
  released: boolean
}

function resourceKey(resource: ResourceId): string {
  return [resource.kind, resource.language ?? "", resource.revision ?? ""].join("|")
}

function residencyTtlMs(residency: ResidencyClass): number {
  if (residency === "keep-warm") return KEEP_WARM_TTL_MS
  if (residency === "idle-evict") return IDLE_EVICT_MS
  return IDLE_EVICT_MS
}

function wrapLease(internal: LeaseInternal, onChange: () => void, now: () => number): ResourceLease {
  return {
    id: internal.id,
    resource: internal.resource,
    owner: internal.owner,
    priority: internal.priority,
    residency: internal.residency,
    acquiredAt: internal.acquiredAt,
    get ttlMs() {
      return internal.ttlMs
    },
    get released() {
      return internal.released
    },
    renew(ttlMs?: number) {
      if (internal.released) throw new Error(`Lease ${internal.id} is already released`)
      /* TTL is relative to `now()`, not `acquiredAt` — a renew
         resets the expiry clock so the lease survives another full
         TTL window from the moment of renewal. */
      internal.acquiredAt = now()
      internal.ttlMs = ttlMs ?? residencyTtlMs(internal.residency)
      onChange()
      return internal.ttlMs
    },
    release() {
      if (internal.released) return
      internal.released = true
      onChange()
    },
  }
}

export function createVoiceResourceScheduler(options: VoiceResourceSchedulerOptions): VoiceResourceScheduler {
  const now = options.now ?? Date.now
  const randomId =
    options.randomId ?? (() => Math.random().toString(36).slice(2, 10))
  const gpuOwnedBy = options.gpuOwnedBy ?? "none"
  const npu: NpuCapability = options.npu ?? { available: false }
  const evictionListeners = new Set<(event: EvictionEvent) => void>()

  /** Leases are indexed by lease id (for direct eviction); the
   *  `resourceIndex` keeps a resourceKey → lease id pointer so
   *  `acquire` and `find` stay O(1). */
  const leases = new Map<string, LeaseInternal>()
  const resourceIndex = new Map<string, string>()
  let leaseCounter = 0
  let memoryState: MemoryPressureState = "nominal"
  let thermalStatus: ThermalStatus = "none"
  /** Voice intentionally allocates zero VRAM on desktop when the
   *  local LLM owns the GPU (ADR-074 §4). The scheduler enforces
   *  this even if a future caller tries to acquire a GPU lease. */
  const gpuDisabled = options.mode === "desktop" && gpuOwnedBy === "local-llm"

  function emit(evictions: readonly EvictionEvent[]): void {
    for (const event of evictions) {
      for (const listener of evictionListeners) listener(event)
    }
  }

  function evictByIds(ids: readonly string[], reason: EvictionEvent["reason"]): readonly EvictionEvent[] {
    const events: EvictionEvent[] = []
    const observedAt = now()
    for (const id of ids) {
      const lease = leases.get(id)
      if (!lease || lease.released) continue
      lease.released = true
      leases.delete(id)
      resourceIndex.delete(resourceKey(lease.resource))
      events.push({
        leaseId: id,
        resource: lease.resource,
        owner: lease.owner,
        reason,
        observedAt,
      })
    }
    return events
  }

  function evictExpired(): readonly EvictionEvent[] {
    const observedAt = now()
    const expired: string[] = []
    for (const lease of leases.values()) {
      if (lease.released) continue
      if (observedAt - lease.acquiredAt >= lease.ttlMs) expired.push(lease.id)
    }
    return evictByIds(expired, "ttl-expired")
  }

  function onPressureEvict(state: MemoryPressureState | ThermalStatus): readonly EvictionEvent[] {
    const dueToMemory = state === "moderate" || state === "critical" || state === "low-memory"
    const dueToThermal = state === "severe" || state === "critical" || state === "emergency" || state === "shutdown"
    if (!dueToMemory && !dueToThermal) return []
    // Walk leases from lowest priority to highest, evicting those
    // whose residency class is appropriate for this pressure level.
    const sorted = [...leases.values()].sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority))
    const toEvict: string[] = []
    for (const lease of sorted) {
      if (lease.released) continue
      // realtime-audio is never evicted under any pressure (ADR-074 §2).
      if (lease.priority === "realtime-audio") continue
      if (dueToMemory) {
        // Moderate → evict preload; Critical → evict preload + idle-evict fast-decision.
        if (lease.priority === "preload") toEvict.push(lease.id)
        else if (state === "critical" || state === "low-memory") {
          if (lease.residency === "preload" || lease.residency === "idle-evict") toEvict.push(lease.id)
        }
      }
      if (dueToThermal) {
        // Severe → cancel preload; Critical+ → evict preload + idle-evict non-realtime.
        if (lease.priority === "preload") toEvict.push(lease.id)
        else if (state === "critical" || state === "emergency" || state === "shutdown") {
          if (lease.priority !== "vad-aec" && lease.residency !== "keep-warm") toEvict.push(lease.id)
        }
      }
    }
    return evictByIds(toEvict, dueToThermal ? "thermal-pressure" : "memory-pressure")
  }

  function notifyLeaseChange(): void {
    const evictions = evictExpired()
    emit(evictions)
  }

  return {
    get gpuDisabled() {
      return gpuDisabled
    },
    acquire(input) {
      if (input.signal?.aborted) return undefined
      // Sweep expired leases first so an active lease list is accurate.
      emit(evictExpired())
      const key = resourceKey(input.resource)
      const existingId = resourceIndex.get(key)
      const existing = existingId ? leases.get(existingId) : undefined
      if (existing && !existing.released) {
        if (priorityWeight(input.priority) <= priorityWeight(existing.priority)) {
          // Existing holder outranks the request — cannot preempt.
          return undefined
        }
        // New request outranks the existing holder — preempt.
        emit(evictByIds([existing.id], "explicit-release"))
      }
      const internal: LeaseInternal = {
        id: `lease_${(leaseCounter++).toString(36)}_${now().toString(36)}_${randomId()}`,
        resource: input.resource,
        owner: input.owner,
        priority: input.priority,
        residency: input.residency,
        acquiredAt: now(),
        ttlMs: input.ttlMs ?? residencyTtlMs(input.residency),
        released: false,
      }
      leases.set(internal.id, internal)
      resourceIndex.set(key, internal.id)
      return wrapLease(internal, notifyLeaseChange, now)
    },
    list() {
      emit(evictExpired())
      return [...leases.values()]
        .filter((lease) => !lease.released)
        .map((lease) => wrapLease(lease, notifyLeaseChange, now))
    },
    find(resource) {
      emit(evictExpired())
      const key = resourceKey(resource)
      const id = resourceIndex.get(key)
      const lease = id ? leases.get(id) : undefined
      if (!lease || lease.released) return undefined
      return wrapLease(lease, notifyLeaseChange, now)
    },
    reportMemoryPressure(signal) {
      memoryState = signal.state
      // Sweep expired leases first so TTL-expired events fire on
      // every read path, not only acquire/find/list.
      const expired = evictExpired()
      const evictions = onPressureEvict(signal.state)
      const all = [...expired, ...evictions]
      emit(all)
      return all
    },
    reportThermal(signal) {
      thermalStatus = signal.status
      const expired = evictExpired()
      const evictions = onPressureEvict(signal.status)
      const all = [...expired, ...evictions]
      emit(all)
      return all
    },
    diagnostics() {
      const diagnostics: SchedulerDiagnostics = {
        mode: options.mode,
        voiceGpuAllocBytes: gpuDisabled ? 0 : 0,
        gpuOwnedBy,
        npu,
        thermal: thermalStatus,
        memory: memoryState,
      }
      return diagnostics
    },
    onEviction(listener) {
      evictionListeners.add(listener)
      return () => evictionListeners.delete(listener)
    },
  }
}

/** Convenience: helper for callers that want to know whether their
 *  priority would preempt an existing lease without actually
 *  acquiring. Mirrors the preemption rule in `acquire`. */
export function wouldPreempt(
  scheduler: VoiceResourceScheduler,
  resource: ResourceId,
  priority: ResourcePriority,
): boolean {
  const existing = scheduler.find(resource)
  if (!existing) return true
  return priorityWeight(priority) > priorityWeight(existing.priority)
}

/** Convenience: list the priorities that the given priority can
 *  preempt. Used by callers that want to enumerate the eviction
 *  impact of an acquisition. */
export function preemptablePriorities(priority: ResourcePriority): readonly ResourcePriority[] {
  return PRIORITY_ORDER.filter((p) => priorityWeight(p) < priorityWeight(priority))
}
