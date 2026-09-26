<!-- SPDX-License-Identifier: MIT -->
# ADR-074: Voice Resource Scheduler — leases, residency, GPU ownership (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-073](../adr/ADR-073-voice-capture-playback-arbitration.md),
> the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md),
> and the v2 plan §32 (R11 — Resource Scheduler).

## Context

The v2 plan §32 requires a central resource coordinator that
tracks memory, CPU, thermal, model residency, inference queues,
GPU ownership, and NPU capability. The local LLM remains
independent but the scheduler must avoid starving it. Model
leases evict inactive heavy models; STT + TTS + FastDecision
must not stay resident for convenience on memory-constrained
Android.

The v2 plan §20 also constrains the scheduler: Voice GPU
allocation = zero by default on desktop when the local LLM
owns the discrete GPU. Mobile policy is adaptive. LLM
throughput regression < 10% is the target.

Today, the desktop Python `voice_host` does not have a central
scheduler; the LiveKit Agents scheduler handles its own
inference queuing. The Android Rust binding has no scheduler
either — each provider loads on demand and stays resident
until the process exits.

This ADR freezes the contract and the priority order. The
implementation lives in the shared `VoiceTurnEngine` package
(per ADR-060) and is gated by the same feature flags
(`voice_engine_v2` / `voice_engine_v2_android`) as the rest of
the v2 migration.

## Decision

1. **ResourceLease** is canonical. A lease grants the right to
   keep a resource (model, inference slot, GPU buffer) warm for
   a bounded duration. Lease holders must `renew()` before TTL
   or the lease is evicted.

   ```ts
   export interface ResourceLease {
     readonly id: string
     readonly resource: ResourceId
     readonly owner: ProviderId
     readonly acquiredAt: number
     readonly ttlMs: number
     readonly priority: ResourcePriority
     renew(ttlMs?: number): void
     release(): void
   }

   export type ResourcePriority =
     | "realtime-audio"      // never evicted while a Live mic lease holds
     | "vad-aec"
     | "active-stt-tts"
     | "fast-decision"
     | "preload"
   ```

2. **Priority order** (top → bottom, higher wins):

   ```
   realtime audio (mic + playback)         ─── never evicted while Live is active
   VAD / AEC                               ─── evicted only under thermal emergency
   active STT / TTS                         ─── evicted on memory pressure if not active
   FastDecision (per ADR-063)               ─── evicted on memory pressure
   preload                                  ─── evicted first
   ```

3. **Model residency**: each provider advertises a residency class:
   - `keep-warm` — never evict while the session is active.
   - `idle-evict` — evict after `IDLE_EVICT_MS` (default 5 min).
   - `preload` — always evict first under any pressure.

4. **GPU ownership**:
   - Desktop: Voice GPU allocation = **zero** by default when
     the local LLM owns the discrete GPU. Voice never allocates
     dedicated VRAM; it uses system RAM and shared GPU only when
     the LLM is idle (and only if the user explicitly opted in).
     The startup ABI diagnostic (per ADR-068) records
     `voice_gpu_alloc_bytes: 0` by default and refuses to start
     if a Voice component attempts a non-zero allocation while
     the LLM owns the GPU.
   - Mobile: adaptive. NPU is the preferred device for VAD and
     AEC where available; CPU fallback is automatic. GPU
     allocation is opportunistic (small, opportunistic chunks
     when the OS reports available headroom).

5. **Memory pressure thresholds** (Android, monitored via the
   platform `ActivityManager` memory state and `getProcessMemoryInfo`):

   | State | Threshold | Action |
   |---|---|---|
   | `MODERATE` | free < 25% of system target | Evict `preload` models; reduce STT beam; warn UI |
   | `CRITICAL` | free < 10% of system target | Evict `idle-evict` STT/TTS if not active; suspend `FastDecision`; refuse new STT/TTS preloads |
   | `LOW_MEMORY` (Android) | `ActivityManager` reports LOW | Same as CRITICAL + cancel any pending preloads |

6. **Thermal pressure** (Android, via `PowerManager.getCurrentThermalStatus`):

   | Status | Action |
   |---|---|
   | `NONE` / `LIGHT` | Nominal operation. |
   | `MODERATE` | Reduce sampling rate of VAD; no new preloads. |
   | `SEVERE` | Downshift STT to a smaller model if available; cancel preload; warn UI. |
   | `CRITICAL` / `EMERGENCY` / `SHUTDOWN` | Pause Live capture; persist session state; surface `voice_error` stage=thermal. |

7. **Inference queue**: the scheduler maintains a priority
   queue per resource. A realtime-audio lease preempts any
   non-realtime inference in the queue. The queue depth and
   head latency are reported in the metrics per ADR-067.

8. **Local LLM coexistence**: the scheduler never preempts a
   running local LLM inference. Voice may run concurrently when
   the LLM is between batches, but Voice never holds the GPU
   while the LLM is mid-batch. The coexistence regression is
   measured per the v2 plan §20: `< 10%` local LLM throughput
   regression is the target. Anything worse is a gate failure
   that blocks R11 adoption.

9. **Lease audit**: a contract test enforces that every
   `ResourceId` is leased before use. Any code path that
   allocates CPU, GPU, NPU, or memory without a lease fails
   the test. The audit is run in CI per platform.

10. **NPU capability**: where the device advertises an NPU
    (Qualcomm Hexagon, MediaTek APU, Apple Neural Engine), the
    scheduler maps the VAD inference to it. The contract is
    `NpuCapability` returned at startup; absent NPU → CPU
    fallback automatically. No silent degraded performance;
    the diagnostic records the chosen device.

11. **Eviction protocol**:
    - Lease holder receives `voice_error` with
      `stage: "resource"` and `code: "EVICTED_<reason>"`.
    - The eviction is recorded in the metrics per ADR-067.
    - The session continues with the next provider in the
      priority chain. If no provider is available, the engine
      emits `voice_error` with `code: "RESOURCE_EXHAUSTED"`.

## Consequences

- A `ResourceScheduler` interface lives in the shared package.
  The desktop Python implementation wraps the LiveKit Agents
  scheduler; the Android Rust implementation wraps a custom
  scheduler that integrates with `ActivityManager` and
  `PowerManager`.
- The startup ABI diagnostic (per ADR-068) gains:
  `scheduler_mode`, `voice_gpu_alloc_bytes`,
  `npu_capability`, `thermal_status`, `memory_state`.
- The Android Rust binding adds `PressureCallback` to the
  Tauri command bridge so the WebView UI can react to
  `resource_pressure` events from ADR-060.
- A lease audit becomes part of CI.

## Open evidence requirements

- A 10-minute endurance test on Windows: STT + TTS + VAD running
  with the local LLM idle. Measure the LLM throughput before
  and during Voice. The regression must be `< 10%` per the v2
  plan §20.
- A 10/30/60-minute endurance test on the Xiaomi:
  - 10 min: nominal.
  - 30 min: thermal status must stay `< SEVERE` for the default
    CPU path.
  - 60 min: peak RSS must stay under the documented budget;
    no OOM.
- A memory-pressure test: `LOW_MEMORY` triggers eviction of
  `preload` and `idle-evict` STT/TTS, and the engine emits the
  correct `voice_error`.
- A lease audit: every `ResourceId` has exactly one lease
  holder; no double-allocation; no leaked lease.

## Status

**DRAFT** — not adopted. The contract, the priority order, the
GPU rule, the memory/thermal policies, and the open evidence
are specified. Adoption requires the contract tests above to
be green and the gate evidence to be recorded.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §5, §15.5
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-063-voice-fast-decision.md](ADR-063-voice-fast-decision.md)
- [ADR-064-voice-desktop-convergence.md](ADR-064-voice-desktop-convergence.md)
- [ADR-066-voice-model-artifact-registry.md](ADR-066-voice-model-artifact-registry.md)
- [ADR-067-voice-privacy-logging-metrics.md](ADR-067-voice-privacy-logging-metrics.md)
- [ADR-068-voice-runtime-abi-onnx.md](ADR-068-voice-runtime-abi-onnx.md)
- [ADR-069-voice-audio-routes-bluetooth.md](ADR-069-voice-audio-routes-bluetooth.md)
- [ADR-070-voice-error-taxonomy-readiness.md](ADR-070-voice-error-taxonomy-readiness.md)
- [ADR-072-voice-offline-network-policy.md](ADR-072-voice-offline-network-policy.md)
- [ADR-073-voice-capture-playback-arbitration.md](ADR-073-voice-capture-playback-arbitration.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §20 (performance targets), §32 (R11), §16 (ADR campaign list)
- `packages/voice-host/voice_host/live/agent.py` — current
  LiveKit Agents pipeline (no central scheduler)
- `packages/mobile/src-tauri/src/speech.rs` — current Android
  Rust STT path (no scheduler)