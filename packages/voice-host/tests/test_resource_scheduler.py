"""Tests for the Python Voice Resource Scheduler wrapper (ADR-074, R11).

Pure-logic tests — no I/O, no real platform bindings, deterministic
clock. Mirrors the TypeScript `resource-scheduler.test.ts` so the
desktop and the Unifia Voice Host agree on the same invariants.

Run via `scripts/voice/voice-host-test-runner.py` which sets
PYTHONPATH so `voice_host.resource_scheduler` is importable.
"""

from __future__ import annotations

import pytest  # noqa: F401 — used by pytest fixtures

from voice_host.resource_scheduler import (
    EvictionReason,
    MemoryPressureState,
    ResidencyClass,
    ResourceId,
    ResourcePriority,
    ThermalStatus,
    VoiceResourceScheduler,
    priority_weight,
    would_preempt,
)


class FakeClock:
    def __init__(self, initial: int = 0) -> None:
        self.value = initial

    def __call__(self) -> int:
        return self.value

    def advance(self, ms: int) -> None:
        self.value += ms


def make_scheduler(
    *,
    mode: str = "desktop",
    gpu_owned_by: str = "none",
    clock: FakeClock | None = None,
) -> tuple[VoiceResourceScheduler, FakeClock]:
    clock = clock or FakeClock()
    scheduler = VoiceResourceScheduler(
        mode=mode,
        gpu_owned_by=gpu_owned_by,
        now=clock,
        random_id=lambda: "abc",
    )
    return scheduler, clock


VAD = ResourceId(kind="vad", revision="v6.2.2")
TTS_FR = ResourceId(kind="tts", language="fr")
STT_FR = ResourceId(kind="stt", language="fr")
PRELOAD_IT = ResourceId(kind="tts", language="it")
AUDIO_AEC = ResourceId(kind="aec", revision="platform")


# --- acquire / refuse / preempt ---------------------------------------------


def test_acquires_a_lease_when_no_holder_exists() -> None:
    scheduler, _ = make_scheduler()
    lease = scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    assert lease is not None
    assert lease.priority == ResourcePriority.VAD_AEC
    assert lease.owner == "silero-vad"
    assert len(scheduler.list()) == 1


def test_refuses_lower_or_equal_priority_against_active_holder() -> None:
    scheduler, _ = make_scheduler()
    first = scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    assert first is not None
    second = scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    assert second is None
    third = scheduler.acquire(VAD, owner="custom", priority=ResourcePriority.PRELOAD, residency=ResidencyClass.PRELOAD)
    assert third is None


def test_higher_priority_preempts_existing_holder_and_emits_eviction() -> None:
    scheduler, _ = make_scheduler()
    evicted: list[str] = []
    scheduler.on_eviction(lambda event: evicted.append(event.lease_id))
    scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    winner = scheduler.acquire(
        VAD, owner="livekit", priority=ResourcePriority.REALTIME_AUDIO, residency=ResidencyClass.KEEP_WARM
    )
    assert winner is not None
    listed = scheduler.list()
    assert len(listed) == 1
    assert listed[0].owner == "livekit"
    assert len(evicted) == 1


# --- memory pressure -------------------------------------------------------


def test_moderate_memory_pressure_evicts_preload_keeps_vad() -> None:
    scheduler, _ = make_scheduler()
    scheduler.acquire(PRELOAD_IT, owner="piper", priority=ResourcePriority.PRELOAD, residency=ResidencyClass.PRELOAD)
    scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    evictions = scheduler.report_memory_pressure(MemoryPressureState.MODERATE)
    assert [e.resource for e in evictions] == [PRELOAD_IT]
    assert [lease.resource for lease in scheduler.list()] == [VAD]


def test_critical_memory_pressure_evicts_preload_plus_idle_evict_but_keeps_realtime_audio() -> None:
    scheduler, _ = make_scheduler()
    scheduler.acquire(PRELOAD_IT, owner="piper", priority=ResourcePriority.PRELOAD, residency=ResidencyClass.PRELOAD)
    scheduler.acquire(STT_FR, owner="parakeet-tdt", priority=ResourcePriority.ACTIVE_STT_TTS, residency=ResidencyClass.IDLE_EVICT)
    scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    scheduler.acquire(AUDIO_AEC, owner="livekit", priority=ResourcePriority.REALTIME_AUDIO, residency=ResidencyClass.KEEP_WARM)
    evictions = scheduler.report_memory_pressure(MemoryPressureState.CRITICAL)
    remaining = [lease.resource for lease in scheduler.list()]
    assert VAD in remaining
    assert AUDIO_AEC in remaining
    assert PRELOAD_IT not in remaining
    assert STT_FR not in remaining
    assert len(evictions) == 2


# --- thermal pressure ------------------------------------------------------


def test_severe_thermal_pressure_cancels_preload_keeps_vad() -> None:
    scheduler, _ = make_scheduler()
    scheduler.acquire(PRELOAD_IT, owner="piper", priority=ResourcePriority.PRELOAD, residency=ResidencyClass.PRELOAD)
    scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    evictions = scheduler.report_thermal(ThermalStatus.SEVERE)
    assert [e.reason for e in evictions] == [EvictionReason.THERMAL_PRESSURE]
    assert [lease.resource for lease in scheduler.list()] == [VAD]


def test_realtime_audio_never_evicted_under_any_pressure() -> None:
    scheduler, _ = make_scheduler()
    scheduler.acquire(AUDIO_AEC, owner="livekit", priority=ResourcePriority.REALTIME_AUDIO, residency=ResidencyClass.KEEP_WARM)
    for state in (MemoryPressureState.CRITICAL, MemoryPressureState.LOW_MEMORY):
        scheduler.report_memory_pressure(state)
    for status in (ThermalStatus.SEVERE, ThermalStatus.CRITICAL, ThermalStatus.EMERGENCY, ThermalStatus.SHUTDOWN):
        scheduler.report_thermal(status)
    assert [lease.resource for lease in scheduler.list()] == [AUDIO_AEC]


# --- TTL --------------------------------------------------------------------


def test_expires_leases_past_ttl() -> None:
    scheduler, clock = make_scheduler()
    scheduler.acquire(
        STT_FR,
        owner="parakeet-tdt",
        priority=ResourcePriority.ACTIVE_STT_TTS,
        residency=ResidencyClass.IDLE_EVICT,
        ttl_ms=100,
    )
    clock.advance(150)
    assert scheduler.list() == []


def test_release_makes_resource_available_again() -> None:
    scheduler, _ = make_scheduler()
    lease = scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    assert lease is not None
    lease.release()
    assert scheduler.find(VAD) is None
    second = scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    assert second is not None


def test_renew_extends_ttl_relative_to_now() -> None:
    scheduler, clock = make_scheduler()
    lease = scheduler.acquire(
        VAD,
        owner="silero-vad",
        priority=ResourcePriority.VAD_AEC,
        residency=ResidencyClass.KEEP_WARM,
        ttl_ms=100,
    )
    assert lease is not None
    clock.advance(80)
    lease.renew(200)
    clock.advance(150)
    assert scheduler.find(VAD) is not None


# --- GPU ownership ---------------------------------------------------------


def test_desktop_local_llm_gpu_ownership_disables_voice_vram() -> None:
    scheduler, _ = make_scheduler(mode="desktop", gpu_owned_by="local-llm")
    assert scheduler.gpu_disabled is True
    diag = scheduler.diagnostics()
    assert diag["voice_gpu_alloc_bytes"] == 0
    assert diag["gpu_owned_by"] == "local-llm"


def test_priority_weight_orders_realtime_audio_above_preload() -> None:
    assert priority_weight(ResourcePriority.REALTIME_AUDIO) > priority_weight(ResourcePriority.PRELOAD)
    assert priority_weight(ResourcePriority.VAD_AEC) > priority_weight(ResourcePriority.ACTIVE_STT_TTS)


def test_would_preempt_matches_acquire_rule() -> None:
    scheduler, _ = make_scheduler()
    assert would_preempt(scheduler, VAD, ResourcePriority.REALTIME_AUDIO) is True
    scheduler.acquire(VAD, owner="silero-vad", priority=ResourcePriority.VAD_AEC, residency=ResidencyClass.KEEP_WARM)
    assert would_preempt(scheduler, VAD, ResourcePriority.REALTIME_AUDIO) is True
    assert would_preempt(scheduler, VAD, ResourcePriority.VAD_AEC) is False
    assert would_preempt(scheduler, VAD, ResourcePriority.PRELOAD) is False


def test_listener_fires_for_every_eviction_reason() -> None:
    scheduler, clock = make_scheduler()
    reasons: list[EvictionReason] = []
    scheduler.on_eviction(lambda event: reasons.append(event.reason))
    # (a) preload evicted by moderate memory pressure.
    scheduler.acquire(PRELOAD_IT, owner="piper", priority=ResourcePriority.PRELOAD, residency=ResidencyClass.PRELOAD)
    scheduler.report_memory_pressure(MemoryPressureState.MODERATE)
    # (b) second preload evicted by severe thermal pressure.
    scheduler.acquire(TTS_FR, owner="piper", priority=ResourcePriority.PRELOAD, residency=ResidencyClass.PRELOAD)
    scheduler.report_thermal(ThermalStatus.SEVERE)
    # (c) idle-evict STT expires by TTL after the clock advances.
    scheduler.acquire(
        STT_FR,
        owner="parakeet-tdt",
        priority=ResourcePriority.ACTIVE_STT_TTS,
        residency=ResidencyClass.IDLE_EVICT,
        ttl_ms=50,
    )
    clock.advance(60)
    scheduler.report_memory_pressure(MemoryPressureState.NOMINAL)
    assert EvictionReason.MEMORY_PRESSURE in reasons
    assert EvictionReason.THERMAL_PRESSURE in reasons
    assert EvictionReason.TTL_EXPIRED in reasons
