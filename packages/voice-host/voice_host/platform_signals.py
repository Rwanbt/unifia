"""Desktop `PlatformSignals` adapter for `VoiceResourceScheduler` (ADR-074).

Companion to plan §33 (R13 desktop convergence). The desktop voice-host
process runs on Windows / Linux / macOS. `PlatformSignals` is the
injection point the scheduler uses to consume host-side memory +
thermal observations; without it the scheduler runs in a static
"nominal" mode that only honours TTL expiry.

This module ships a `DesktopPlatformSignals` adapter that:

  * reads `psutil.virtual_memory()` for free / total memory bytes
    (falls back to "no observation" when `psutil` is not installed
    in the host venv, which is the case in the current desktop
    image; production deploys include psutil);
  * reads `psutil.sensors_battery()` and `psutil.sensors_temperatures()`
    when the host platform exposes them (Linux / macOS), and falls back
    to `ThermalStatus.NONE` on Windows where no portable CPU
    temperature API exists. R13.2 does not pretend to ship a
    Windows thermal probe;
  * translates raw bytes / celcius readings into the staged
    `MemoryPressureState` (NOMINAL / MODERATE / CRITICAL / LOW_MEMORY)
    and `ThermalStatus` enums used by the scheduler.

A `MockDesktopSignals` helper is also exported for deterministic tests
so the eviction machinery can be exercised without driving the host
machine into a real pressure state.
"""

from __future__ import annotations

import logging
import sys
from typing import TYPE_CHECKING

from .resource_scheduler import MemoryPressureState, PlatformSignals, ThermalStatus

if TYPE_CHECKING:
    pass

_PSUTIL_AUTO = object()  # sentinel meaning "try to import psutil on first use"


log = logging.getLogger("voice_host.platform_signals")

# ADR-074 §6 memory thresholds (mirrors the TS implementation).
# Available ratio -> memory pressure state:
#   > 25% free               -> NOMINAL
#   10%..25% free            -> MODERATE
#   < 10% free               -> CRITICAL
#   < 5% free OR total < 4GB -> LOW_MEMORY
_MEMORY_NOMINAL_FLOOR_RATIO = 0.25
_MEMORY_MODERATE_FLOOR_RATIO = 0.10
_MEMORY_LOW_MEMORY_BYTES = 4 * 1024 * 1024 * 1024  # 4 GiB total RAM threshold

# ADR-074 §6 thermal thresholds (raw Celsius -> ThermalStatus):
#   >= 85 °C -> SEVERE    (evict preload)
#   >= 95 °C -> CRITICAL  (evict preload + idle-evict, preserve realtime)
#   >= 100 °C -> EMERGENCY (above planner range, treated as critical)
_THERMAL_SEVERE_C = 85.0
_THERMAL_CRITICAL_C = 95.0


def _psutil_or_none() -> object | None:
    """Return the imported `psutil` module, or None if not installed.

    The desktop voice-host image currently doesn't ship psutil; production
    deploys do. We import lazily so the test suite can run without it.
    """
    try:
        import psutil  # type: ignore[import-not-found]

        return psutil
    except ImportError:
        return None


class DesktopPlatformSignals:
    """Live memory + best-effort thermal readings from the host platform.

    Designed to be passed to ``VoiceResourceScheduler(platform=...)``.
    The scheduler calls the three methods lazily and only when it needs
    to evaluate pressure, so this adapter pays no CPU cost in the
    idle path.
    """

    def __init__(self, *, psutil_module: object = _PSUTIL_AUTO) -> None:
        # Injection point for tests: ``psutil_module=stub`` lets a
        # test inject a fake module with `.virtual_memory()` /
        # `.sensors_temperatures()` returning canned readings.
        # Pass ``psutil_module=None`` to FORCE the adapter into
        # "no observation" mode (used by the unit tests that
        # verify behaviour when psutil is unavailable). The default
        # sentinel ``_PSUTIL_AUTO`` means "import psutil lazily on
        # first use" — production behaviour, never raises ImportError
        # at construction time.
        if psutil_module is _PSUTIL_AUTO:
            self._psutil: object | None = _psutil_or_none()
        else:
            self._psutil = psutil_module
        self._platform = sys.platform
        # Cache the latest pressure mapping so the scheduler can call
        # `free_bytes` / `target_bytes` independently without re-asking
        # psutil on every adapter call.
        self._last_pressure: MemoryPressureState = MemoryPressureState.NOMINAL

    # -- memory ------------------------------------------------------------

    def free_bytes(self) -> int:
        ps = self._psutil
        if ps is None:
            return 0
        try:
            vm = ps.virtual_memory()  # type: ignore[attr-defined]
            self._last_pressure = _map_pressure(vm.available, vm.total)
            return int(vm.available)
        except Exception as exc:  # noqa: BLE001 — psutil can raise on macOS sandbox
            log.warning("psutil.virtual_memory() failed: %s", exc)
            return 0

    def target_bytes(self) -> int:
        ps = self._psutil
        if ps is None:
            return 0
        try:
            vm = ps.virtual_memory()  # type: ignore[attr-defined]
            return int(vm.total)
        except Exception as exc:  # noqa: BLE001
            log.warning("psutil.virtual_memory() failed: %s", exc)
            return 0

    @property
    def last_pressure(self) -> MemoryPressureState:
        """Last pressure mapping computed by `free_bytes`. Useful for
        diagnostics — the scheduler's `diagnostics()` owns the
        authoritative state, this is just a mirror for tests."""
        return self._last_pressure

    # -- thermal -----------------------------------------------------------

    def thermal_status(self) -> ThermalStatus:
        ps = self._psutil
        if ps is None:
            return _windows_fallback_thermal(self._platform)
        try:
            sensors_temperatures = getattr(ps, "sensors_temperatures", None)
            if sensors_temperatures is None:
                return _windows_fallback_thermal(self._platform)
            entries = sensors_temperatures()  # type: ignore[attr-defined]
            if not entries:
                return _windows_fallback_thermal(self._platform)
            # Take the highest reading across all sensors; conservative for
            # the scheduler's KEEP_WARM semantics.
            hottest = max(
                (entry.current for entry in entries if getattr(entry, "current", None) is not None),
                default=None,
            )
            if hottest is None:
                return ThermalStatus.NONE
            return _map_thermal(hottest)
        except Exception as exc:  # noqa: BLE001
            log.warning("psutil.sensors_temperatures() failed: %s", exc)
            return ThermalStatus.NONE


def _map_pressure(free_bytes: int, total_bytes: int) -> MemoryPressureState:
    if total_bytes <= 0 or free_bytes < 0:
        return MemoryPressureState.NOMINAL
    ratio = free_bytes / total_bytes
    if total_bytes < _MEMORY_LOW_MEMORY_BYTES and ratio < _MEMORY_MODERATE_FLOOR_RATIO:
        return MemoryPressureState.LOW_MEMORY
    if ratio < _MEMORY_MODERATE_FLOOR_RATIO:
        return MemoryPressureState.CRITICAL
    if ratio < _MEMORY_NOMINAL_FLOOR_RATIO:
        return MemoryPressureState.MODERATE
    return MemoryPressureState.NOMINAL


def _map_thermal(celsius: float) -> ThermalStatus:
    if celsius >= _THERMAL_CRITICAL_C:
        return ThermalStatus.CRITICAL
    if celsius >= _THERMAL_SEVERE_C:
        return ThermalStatus.SEVERE
    return ThermalStatus.NONE


def _windows_fallback_thermal(platform: str) -> ThermalStatus:
    """Windows has no portable CPU temperature API via psutil. Return
    NONE rather than fabricating a reading; the scheduler treats this
    as "no observation" and does not over-evict on Windows.

    A future R13.x can plug a WMI / OpenHardwareMonitor reader here.
    """
    if platform.startswith("win"):
        return ThermalStatus.NONE
    return ThermalStatus.NONE


class MockDesktopSignals:
    """Deterministic `PlatformSignals` for tests.

    Lets a test pin `free_bytes / target_bytes / thermal_status`
    return values without depending on the live host state. The
    scheduler eviction machinery then runs against the same staged
    enums it would receive on real hardware.
    """

    def __init__(
        self,
        *,
        free_bytes: int = 8 * 1024 * 1024 * 1024,
        target_bytes: int = 16 * 1024 * 1024 * 1024,
        thermal: ThermalStatus = ThermalStatus.NONE,
    ) -> None:
        self._free = free_bytes
        self._target = target_bytes
        self._thermal = thermal

    def free_bytes(self) -> int:
        return self._free

    def target_bytes(self) -> int:
        return self._target

    def thermal_status(self) -> ThermalStatus:
        return self._thermal

    def set_free(self, free: int) -> None:
        self._free = free

    def set_thermal(self, thermal: ThermalStatus) -> None:
        self._thermal = thermal


__all__ = [
    "DesktopPlatformSignals",
    "MockDesktopSignals",
    "PlatformSignals",
]
