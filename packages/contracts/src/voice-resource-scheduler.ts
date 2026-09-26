/* SPDX-License-Identifier: MIT */
/**
 * Voice Resource Scheduler — leases, residency, GPU ownership.
 *
 * Companion to ADR-074 (R11 — Resource Scheduler). The shared
 * `VoiceTurnEngine` (ADR-060) owns the platform-independent voice
 * semantics; this module owns the platform-independent resource
 * coordination layer that backs it.
 *
 * The scheduler is intentionally narrow: types + a small interface.
 * Platform-specific monitoring (Android ActivityManager / PowerManager,
 * Windows GPU drivers, etc.) is supplied by the host via callbacks.
 * Pure logic — priority ordering, eviction policy, GPU ownership —
 * lives in `packages/app/src/voice/resource-scheduler.ts`.
 */

export type ResourcePriority =
  /* realtime audio (mic + playback) — never evicted while a Live
     capture lease holds */
  | "realtime-audio"
  /* VAD / AEC — evicted only under thermal emergency */
  | "vad-aec"
  /* active STT / TTS — evicted on memory pressure if not active */
  | "active-stt-tts"
  /* FastDecision (per ADR-063) — evicted on memory pressure */
  | "fast-decision"
  /* preload — evicted first under any pressure */
  | "preload"

export type ResidencyClass =
  /* keep-warm — never evict while the session is active */
  | "keep-warm"
  /* idle-evict — evict after IDLE_EVICT_MS (default 5 min) of
     inactivity */
  | "idle-evict"
  /* preload — always evict first under any pressure */
  | "preload"

/** Identifies a single schedulable resource (model, slot, buffer). */
export interface ResourceId {
  readonly kind: "stt" | "tts" | "vad" | "aec" | "turn-detector" | "fast-decision"
  readonly language?: string
  readonly revision?: string
}

/** Identifies the provider that owns the resource. */
export type ProviderId =
  | "silero-vad"
  | "parakeet-tdt"
  | "moonshine"
  | "pocket-tts"
  | "piper"
  | "rules-fast-decision"
  | "tiny-classifier"
  | "livekit"
  | "custom"

export interface ResourceLease {
  readonly id: string
  readonly resource: ResourceId
  readonly owner: ProviderId
  readonly priority: ResourcePriority
  readonly residency: ResidencyClass
  /** Monotonic timestamp when the lease was acquired. */
  readonly acquiredAt: number
  /** Lease TTL in milliseconds. */
  readonly ttlMs: number
  /** Renew the lease before it expires. Returns the new TTL. */
  renew(ttlMs?: number): number
  /** Release the lease immediately. Idempotent. */
  release(): void
  /** Has this lease been released? */
  readonly released: boolean
}

export type MemoryPressureState = "nominal" | "moderate" | "critical" | "low-memory"

export type ThermalStatus =
  | "none"
  | "light"
  | "moderate"
  | "severe"
  | "critical"
  | "emergency"
  | "shutdown"

/** Reported by the host to the scheduler when memory state changes. */
export interface MemoryPressureSignal {
  readonly state: MemoryPressureState
  /** Free bytes available for the process. */
  readonly freeBytes?: number
  /** Total target bytes for the device. */
  readonly targetBytes?: number
  readonly observedAt: number
}

/** Reported by the host to the scheduler when thermal status changes. */
export interface ThermalSignal {
  readonly status: ThermalStatus
  readonly observedAt: number
}

/** NPU capability advertised at startup. Absent NPU falls back to CPU. */
export interface NpuCapability {
  readonly available: boolean
  readonly vendor?: "qualcomm-hexagon" | "mediatek-apu" | "apple-neural-engine" | "samsung-npu" | string
  /** Stable identifier for diagnostics; undefined when unavailable. */
  readonly deviceId?: string
}

/** Coarse runtime diagnostics captured at startup (per ADR-068). */
export interface SchedulerDiagnostics {
  readonly mode: "desktop" | "mobile"
  readonly voiceGpuAllocBytes: number
  readonly gpuOwnedBy: "voice" | "local-llm" | "shared" | "none"
  readonly npu: NpuCapability
  readonly thermal: ThermalStatus
  readonly memory: MemoryPressureState
}

/** Event emitted when a lease is evicted. */
export interface EvictionEvent {
  readonly leaseId: string
  readonly resource: ResourceId
  readonly owner: ProviderId
  readonly reason: "memory-pressure" | "thermal-pressure" | "ttl-expired" | "explicit-release" | "gpu-reclaimed"
  readonly observedAt: number
}

export interface VoiceResourceScheduler {
  /**
   * Try to acquire a lease. Returns `undefined` if the resource is
   * already leased at a strictly higher priority and the new request
   * cannot preempt it. The optional `signal` lets the caller abort the
   * acquisition before the scheduler decides.
   */
  acquire(input: {
    resource: ResourceId
    owner: ProviderId
    priority: ResourcePriority
    residency: ResidencyClass
    ttlMs?: number
    signal?: AbortSignal
  }): ResourceLease | undefined

  /** List active leases (for diagnostics + the lease audit). */
  list(): readonly ResourceLease[]

  /** Find the active lease for a resource, if any. */
  find(resource: ResourceId): ResourceLease | undefined

  /** Report memory pressure. Triggers eviction as per ADR-074 §5. */
  reportMemoryPressure(signal: MemoryPressureSignal): readonly EvictionEvent[]

  /** Report thermal status. Triggers eviction as per ADR-074 §6. */
  reportThermal(signal: ThermalSignal): readonly EvictionEvent[]

  /** True when this scheduler refuses to allocate any GPU VRAM. */
  readonly gpuDisabled: boolean

  /** Diagnostics snapshot (per ADR-068 startup diagnostic). */
  diagnostics(): SchedulerDiagnostics

  /** Eviction event listener. Called synchronously after each eviction. */
  onEviction(listener: (event: EvictionEvent) => void): () => void
}

/** Default TTL for `idle-evict` residency, in milliseconds. */
export const IDLE_EVICT_MS = 5 * 60 * 1000

/** Default TTL for `keep-warm` residency, in milliseconds. */
export const KEEP_WARM_TTL_MS = 30 * 60 * 1000

/** Priority order, top wins. Used by the implementation to sort leases
 *  and to decide which leases survive under pressure. */
export const PRIORITY_ORDER: readonly ResourcePriority[] = [
  "realtime-audio",
  "vad-aec",
  "active-stt-tts",
  "fast-decision",
  "preload",
] as const

/** Numeric weight for a priority — higher number wins.
 *  realtime-audio (top of the order, never evicted) = highest weight,
 *  preload (bottom of the order, evicted first) = 0. */
export function priorityWeight(priority: ResourcePriority): number {
  const idx = PRIORITY_ORDER.indexOf(priority)
  if (idx < 0) return -1
  return PRIORITY_ORDER.length - 1 - idx
}
