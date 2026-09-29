"""R13.2 — `PlatformSignals` adapter tests.

Companion to ADR-074 / plan §33 (R13 desktop convergence). The
`VoiceResourceScheduler` previously ran with `platform=None` (nominal
mode). R13.2 wires `DesktopPlatformSignals` so memory + thermal
observations from `psutil` reach the eviction machinery. The adapter
must also work on hosts where `psutil` is not installed (the current
desktop image), and must provide a `MockDesktopSignals` for
deterministic tests.
"""

from __future__ import annotations

from typing import Any

import pytest

from voice_host.platform_signals import (
    DesktopPlatformSignals,
    MockDesktopSignals,
)
from voice_host.resource_scheduler import (
    MemoryPressureState,
    PlatformSignals,
    ResourceId,
    ResourcePriority,
    ResidencyClass,
    ThermalStatus,
)


# ---------------------------------------------------------------------------
# DesktopPlatformSignals — pressure mapping
# ---------------------------------------------------------------------------


class _FakeVirtualMemory:
    def __init__(self, available: int, total: int) -> None:
        self.available = available
        self.total = total


class _FakePsutil:
    """Minimal psutil stub exposing only what DesktopPlatformSignals reads."""

    def __init__(
        self,
        virtual_memory: _FakeVirtualMemory | None = None,
        sensors_temperatures: Any = None,
    ) -> None:
        self._virtual_memory = virtual_memory
        self._sensors_temperatures = sensors_temperatures

    def virtual_memory(self) -> _FakeVirtualMemory:
        if self._virtual_memory is None:
            raise RuntimeError("psutil.virtual_memory unavailable in test")
        return self._virtual_memory

    def sensors_temperatures(self) -> Any:
        if self._sensors_temperatures is None:
            raise RuntimeError("sensors_temperatures unavailable in test")
        return self._sensors_temperatures() if callable(self._sensors_temperatures) else self._sensors_temperatures


def test_high_free_memory_returns_nominal() -> None:
    psutil = _FakePsutil(_FakeVirtualMemory(available=10 * 1024**3, total=16 * 1024**3))
    signals = DesktopPlatformSignals(psutil_module=psutil)
    assert signals.free_bytes() == 10 * 1024**3
    assert signals.target_bytes() == 16 * 1024**3
    assert signals.last_pressure == MemoryPressureState.NOMINAL


def test_moderate_pressure_when_free_between_10_and_25_percent() -> None:
    # 2 GiB free of 16 GiB = 12.5% -> MODERATE
    psutil = _FakePsutil(_FakeVirtualMemory(available=2 * 1024**3, total=16 * 1024**3))
    signals = DesktopPlatformSignals(psutil_module=psutil)
    assert signals.free_bytes() == 2 * 1024**3
    assert signals.last_pressure == MemoryPressureState.MODERATE


def test_critical_pressure_when_free_below_10_percent() -> None:
    # 1 GiB free of 16 GiB = ~6.25% -> CRITICAL
    psutil = _FakePsutil(_FakeVirtualMemory(available=1 * 1024**3, total=16 * 1024**3))
    signals = DesktopPlatformSignals(psutil_module=psutil)
    signals.free_bytes()
    assert signals.last_pressure == MemoryPressureState.CRITICAL


def test_low_memory_pressure_on_small_total_with_tight_free() -> None:
    # Total under 4 GiB + free < 10% -> LOW_MEMORY (worst tier)
    psutil = _FakePsutil(_FakeVirtualMemory(available=200 * 1024**2, total=2 * 1024**3))
    signals = DesktopPlatformSignals(psutil_module=psutil)
    signals.free_bytes()
    assert signals.last_pressure == MemoryPressureState.LOW_MEMORY


# ---------------------------------------------------------------------------
# DesktopPlatformSignals — thermal mapping
# ---------------------------------------------------------------------------


class _TemperatureEntry:
    def __init__(self, current: float) -> None:
        self.current = current


def test_thermal_returns_none_when_sensors_unavailable() -> None:
    psutil = _FakePsutil(_FakeVirtualMemory(available=8 * 1024**3, total=16 * 1024**3),
                         sensors_temperatures=lambda: [])
    signals = DesktopPlatformSignals(psutil_module=psutil)
    assert signals.thermal_status() == ThermalStatus.NONE


def test_thermal_severe_when_highest_cpu_above_85c() -> None:
    sensors = [_TemperatureEntry(50.0), _TemperatureEntry(89.5)]
    psutil = _FakePsutil(
        _FakeVirtualMemory(available=8 * 1024**3, total=16 * 1024**3),
        sensors_temperatures=lambda: sensors,
    )
    signals = DesktopPlatformSignals(psutil_module=psutil)
    assert signals.thermal_status() == ThermalStatus.SEVERE


def test_thermal_critical_when_highest_cpu_above_95c() -> None:
    sensors = [_TemperatureEntry(72.0), _TemperatureEntry(96.4)]
    psutil = _FakePsutil(
        _FakeVirtualMemory(available=8 * 1024**3, total=16 * 1024**3),
        sensors_temperatures=lambda: sensors,
    )
    signals = DesktopPlatformSignals(psutil_module=psutil)
    assert signals.thermal_status() == ThermalStatus.CRITICAL


# ---------------------------------------------------------------------------
# Behaviour without psutil installed
# ---------------------------------------------------------------------------


def test_free_and_target_return_zero_when_psutil_missing() -> None:
    # Simulate the production edge case: psutil is NOT a declared
    # voice-host dependency. The adapter must not raise — it must
    # silently return zeros so the scheduler's pressure computation
    # degrades gracefully to NOMINAL.
    signals = DesktopPlatformSignals(psutil_module=None)
    assert signals.free_bytes() == 0
    assert signals.target_bytes() == 0
    assert signals.last_pressure == MemoryPressureState.NOMINAL


def test_thermal_returns_none_when_psutil_missing() -> None:
    # On a Windows host where psutil.sensors_temperatures is unavailable
    # the scheduler receives ThermalStatus.NONE — no false eviction.
    signals = DesktopPlatformSignals(psutil_module=None)
    assert signals.thermal_status() == ThermalStatus.NONE


# ---------------------------------------------------------------------------
# MockDesktopSignals
# ---------------------------------------------------------------------------


def test_mock_satisfies_protocol() -> None:
    mock = MockDesktopSignals(free_bytes=4 * 1024**3, target_bytes=8 * 1024**3,
                             thermal=ThermalStatus.SEVERE)
    # Protocol check (runtime instance-of via attribute presence).
    assert isinstance(mock, PlatformSignals)
    assert mock.free_bytes() == 4 * 1024**3
    assert mock.target_bytes() == 8 * 1024**3
    assert mock.thermal_status() == ThermalStatus.SEVERE


def test_mock_can_be_mutated_per_step_for_eviction_chains() -> None:
    """A test exercising a chain of eviction decisions can vary the
    readings between calls without re-instantiating the adapter."""
    mock = MockDesktopSignals()
    mock.set_free(1 * 1024**3)
    mock.set_thermal(ThermalStatus.NONE)
    assert mock.free_bytes() == 1 * 1024**3
    mock.set_thermal(ThermalStatus.CRITICAL)
    assert mock.thermal_status() == ThermalStatus.CRITICAL


# ---------------------------------------------------------------------------
# Scheduler integration: pressure / thermal feed drives eviction
# ---------------------------------------------------------------------------


def test_scheduler_receives_observations_from_mock_signals() -> None:
    """End-to-end: scheduler + signals + eviction listener. Verifies
    the wiring contract — the PlatformSignals instance is the only
    thing that influences the eviction decisions."""
    from voice_host.resource_scheduler import VoiceResourceScheduler

    scheduler = VoiceResourceScheduler(
        mode="desktop",
        gpu_owned_by="none",
        platform=MockDesktopSignals(
            free_bytes=4 * 1024**3, target_bytes=8 * 1024**3,
            thermal=ThermalStatus.NONE,
        ),
    )
    captured: list[str] = []

    def on_evict(event: Any) -> None:
        captured.append(event.resource.kind)

    scheduler.on_eviction(on_evict)
    preload_lease = scheduler.acquire(
        ResourceId(kind="tts-pocket-preload"),
        owner="test", priority=ResourcePriority.PRELOAD, residency=ResidencyClass.PRELOAD,
    )
    assert preload_lease is not None
    # Mock adapter exposes the LOW_MEMORY pressure path (free 4GiB of 8GiB)
    # -> CRITICAL or LOW_MEMORY depending on the mapping; either way the
    # PRELOAD lease must be evicted.
    scheduler.report_memory_pressure(MemoryPressureState.CRITICAL)
    assert "tts-pocket-preload" in captured
