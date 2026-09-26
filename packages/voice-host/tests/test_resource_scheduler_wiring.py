"""R13 desktop convergence — Resource Scheduler wiring tests.

Companion to ADR-074 / plan §33 (R13 — Desktop/Server Convergence). The
``VoiceResourceScheduler`` Python wrapper (R11 commit ``d2630678c4``) is
cabled into ``voice_host.live.SharedResources`` so every Live room of a
process shares one scheduler + one KEEP_WARM lease for the Silero VAD
model. These tests assert:

  * ``SharedResources`` carries the scheduler field
  * diagnostics match the ADR-074 desktop defaults (Voice VRAM = 0 when
    a local LLM owns the GPU; PLATFORM_NONE otherwise)
  * the KEEP_WARM lease for VAD survives every startup-warm signal
  * thermal pressure can evict PRELOAD leases without disturbing
    REALTIME_AUDIO (proves the priority hierarchy is respected by the
    shared instance — not by a per-room clone)
  * ``voice_resource_scheduler`` is optional on legacy call sites so
    older tests that pass keyword-style or positional ``SharedResources``
    keep compiling

The tests don't need a Live room; they construct a ``SharedResources``
with a stub factory and inspect / mutate the embedded scheduler.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from voice_host.live.agent import SharedResources
from voice_host.resource_scheduler import (
    EvictionReason,
    MemoryPressureState,
    ResourceId,
    ResourcePriority,
    ResidencyClass,
    ThermalStatus,
    VoiceResourceScheduler,
)


def _make_router_factory() -> Callable[..., Any]:
    """A no-op router factory: tests never exercise the TTS router; they
    only need a callable to satisfy ``SharedResources.router_factory``."""

    def factory(_on_route: Any) -> Any:
        return None

    return factory


def _stub_lease(scheduler: VoiceResourceScheduler, kind: str,
                priority: ResourcePriority,
                residency: ResidencyClass) -> Any:
    return scheduler.acquire(
        ResourceId(kind=kind),
        owner="r13-test",
        priority=priority,
        residency=residency,
    )


def test_shared_resources_carries_voice_resource_scheduler_field() -> None:
    """The dataclass exposes the scheduler (regression guard for
    forget-to-add-the-field mistakes)."""

    scheduler = VoiceResourceScheduler(mode="desktop", gpu_owned_by="local-llm")
    resources = SharedResources(
        vad=object(),
        recognizer=None,
        stt_error=None,
        router_factory=_make_router_factory(),
        voice_resource_scheduler=scheduler,
    )
    assert resources.voice_resource_scheduler is scheduler


def test_shared_resources_scheduler_is_optional_for_legacy_callers() -> None:
    """`voice_resource_scheduler` defaults to None so older test
    factories that don't pass it keep compiling and running."""

    resources = SharedResources(
        vad=object(),
        recognizer=None,
        stt_error=None,
        router_factory=_make_router_factory(),
    )
    assert resources.voice_resource_scheduler is None


def test_desktop_local_llm_owned_gpu_disables_voice_vram() -> None:
    """ADR-074 §4: desktop + local-llm-owned GPU = voice VRAM = 0."""

    scheduler = VoiceResourceScheduler(mode="desktop", gpu_owned_by="local-llm")
    diagnostics = scheduler.diagnostics()
    assert diagnostics["mode"] == "desktop"
    assert diagnostics["gpu_owned_by"] == "local-llm"
    assert diagnostics["voice_gpu_alloc_bytes"] == 0
    assert scheduler.gpu_disabled is True


def test_keep_warm_lease_for_vad_survives_listing() -> None:
    """The R13 wiring acquires a KEEP_WARM lease for Silero VAD at
    startup; re-listing the scheduler's leases must keep it."""

    scheduler = VoiceResourceScheduler(mode="desktop", gpu_owned_by="local-llm")
    handle = _stub_lease(
        scheduler,
        kind="vad-silero",
        priority=ResourcePriority.VAD_AEC,
        residency=ResidencyClass.KEEP_WARM,
    )
    assert handle is not None
    listed = scheduler.list()
    assert any(
        lease.resource.kind == "vad-silero" and lease.priority == ResourcePriority.VAD_AEC
        for lease in listed
    )


def test_thermal_pressure_does_not_evict_realtime_audio() -> None:
    """CRITICAL thermal pressure must evict PRELOAD only (it is the
    lowest priority and always evictable under thermal pressure), and
    REALTIME_AUDIO leases must survive untouched. This is the ADR-074
    invariant the desktop scheduler guarantees."""

    scheduler = VoiceResourceScheduler(mode="desktop", gpu_owned_by="local-llm")
    realtime = _stub_lease(
        scheduler,
        kind="audio-frame",
        priority=ResourcePriority.REALTIME_AUDIO,
        residency=ResidencyClass.KEEP_WARM,
    )
    preload = _stub_lease(
        scheduler,
        kind="fast-decision-cache",
        priority=ResourcePriority.PRELOAD,
        residency=ResidencyClass.PRELOAD,
    )
    assert realtime is not None and preload is not None

    evictions = scheduler.report_thermal(ThermalStatus.CRITICAL)
    reasons = {event.lease_id for event in evictions}
    assert any(lease_id == preload.id for lease_id in reasons), \
        "PRELOAD lease must be evicted under CRITICAL thermal pressure"
    assert all(lease_id != realtime.id for lease_id in reasons), \
        "REALTIME_AUDIO lease must NEVER be evicted"


def test_eviction_listener_receives_event_with_provider_metadata() -> None:
    """Wiring hook: when the scheduler evicts a lease under pressure,
    the listener fires with enough metadata for the host to react (e.g.
    reload a model on the next session)."""

    scheduler = VoiceResourceScheduler(mode="desktop", gpu_owned_by="local-llm")
    preload = _stub_lease(
        scheduler,
        kind="fast-decision-cache",
        priority=ResourcePriority.PRELOAD,
        residency=ResidencyClass.PRELOAD,
    )
    captured: list[tuple[str, EvictionReason, str]] = []

    def listener(event: Any) -> None:
        captured.append((event.owner, event.reason, event.resource.kind))

    unsubscribe = scheduler.on_eviction(listener)
    try:
        scheduler.report_thermal(ThermalStatus.CRITICAL)
    finally:
        unsubscribe()

    assert captured, "listener must have observed at least one eviction"
    owner, reason, kind = captured[0]
    assert owner == "r13-test"
    assert reason == EvictionReason.THERMAL_PRESSURE
    assert kind == "fast-decision-cache"


def test_memory_pressure_low_memory_triggers_preload_eviction() -> None:
    """ADR-074 §6: LOW_MEMORY memory pressure is the most aggressive
    signal and evicts PRELOAD even when the rest of the pressure
    states treat it as keep-warm."""

    scheduler = VoiceResourceScheduler(mode="desktop", gpu_owned_by="local-llm")
    preload = _stub_lease(
        scheduler,
        kind="parakeet-cache",
        priority=ResourcePriority.PRELOAD,
        residency=ResidencyClass.PRELOAD,
    )
    keepwarm = _stub_lease(
        scheduler,
        kind="vad-silero",
        priority=ResourcePriority.VAD_AEC,
        residency=ResidencyClass.KEEP_WARM,
    )
    assert preload is not None and keepwarm is not None

    evictions = scheduler.report_memory_pressure(MemoryPressureState.LOW_MEMORY)
    evicted_ids = {event.lease_id for event in evictions}
    assert preload.id in evicted_ids
    assert keepwarm.id not in evicted_ids
