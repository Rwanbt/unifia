"""Python wrapper for the Voice Resource Scheduler (ADR-074, R11).

The desktop Voice Host needs a thin Python adapter around the
TypeScript `VoiceResourceScheduler` so that:

  * memory pressure observations come from `psutil` (or the host's
    platform signal layer, when Android bindings are unavailable on
    desktop);
  * thermal observations come from the host platform (Windows
    `Win32_TemperatureProbe`, Linux `/sys/class/thermal`, macOS
    `powermetrics`).
  * lease events are emitted to the existing voice-host logger so
    the metric side can record them per ADR-067 §"Metrics".

The wrapper exposes the same surface as the TypeScript implementation
(`acquire` / `list` / `find` / `report_memory_pressure` /
`report_thermal` / `on_eviction` / `diagnostics`) and is intentionally
dependency-free on platform-specific bindings — the host plugs in a
`PlatformSignals` implementation at construction time.

Pure Python, no I/O, easy to unit-test deterministically.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Iterable, Protocol


class ResourcePriority(str, Enum):
    """ADR-074 §2 priority order. realtime-audio is highest."""

    REALTIME_AUDIO = "realtime-audio"
    VAD_AEC = "vad-aec"
    ACTIVE_STT_TTS = "active-stt-tts"
    FAST_DECISION = "fast-decision"
    PRELOAD = "preload"


# Numeric weight for a priority — higher number wins.
# realtime-audio (top of the order) = highest weight, preload = 0.
_PRIORITY_WEIGHT: dict[ResourcePriority, int] = {
    ResourcePriority.REALTIME_AUDIO: 4,
    ResourcePriority.VAD_AEC: 3,
    ResourcePriority.ACTIVE_STT_TTS: 2,
    ResourcePriority.FAST_DECISION: 1,
    ResourcePriority.PRELOAD: 0,
}


def priority_weight(priority: ResourcePriority) -> int:
    return _PRIORITY_WEIGHT[priority]


class ResidencyClass(str, Enum):
    """ADR-074 §3 residency class."""

    KEEP_WARM = "keep-warm"
    IDLE_EVICT = "idle-evict"
    PRELOAD = "preload"


# Default TTLs in milliseconds (mirrors the TS implementation).
IDLE_EVICT_MS = 5 * 60 * 1000
KEEP_WARM_TTL_MS = 30 * 60 * 1000


def _residency_ttl_ms(residency: ResidencyClass) -> int:
    if residency == ResidencyClass.KEEP_WARM:
        return KEEP_WARM_TTL_MS
    return IDLE_EVICT_MS


class MemoryPressureState(str, Enum):
    NOMINAL = "nominal"
    MODERATE = "moderate"
    CRITICAL = "critical"
    LOW_MEMORY = "low-memory"


class ThermalStatus(str, Enum):
    NONE = "none"
    LIGHT = "light"
    MODERATE = "moderate"
    SEVERE = "severe"
    CRITICAL = "critical"
    EMERGENCY = "emergency"
    SHUTDOWN = "shutdown"


@dataclass(frozen=True)
class ResourceId:
    """Identifies a single schedulable resource (model, slot, buffer)."""

    kind: str
    language: str | None = None
    revision: str | None = None

    def key(self) -> str:
        return f"{self.kind}|{self.language or ''}|{self.revision or ''}"


class EvictionReason(str, Enum):
    MEMORY_PRESSURE = "memory-pressure"
    THERMAL_PRESSURE = "thermal-pressure"
    TTL_EXPIRED = "ttl-expired"
    EXPLICIT_RELEASE = "explicit-release"
    GPU_RECLAIMED = "gpu-reclaimed"


@dataclass(frozen=True)
class EvictionEvent:
    lease_id: str
    resource: ResourceId
    owner: str
    reason: EvictionReason
    observed_at: int


@dataclass
class _LeaseInternal:
    id: str
    resource: ResourceId
    owner: str
    priority: ResourcePriority
    residency: ResidencyClass
    acquired_at: int
    ttl_ms: int
    released: bool = False


class PlatformSignals(Protocol):
    """Inject memory + thermal observations from the host platform.

    The desktop default uses psutil for memory; production deployments
    plug in the Android `ActivityManager` / `PowerManager` callbacks
    by translating them into the same `report_memory_pressure` /
    `report_thermal` calls on the scheduler instance.
    """

    def free_bytes(self) -> int: ...
    def target_bytes(self) -> int: ...
    def thermal_status(self) -> ThermalStatus: ...


@dataclass
class _LeaseHandle:
    """Public wrapper around the internal lease — mirrors the TS interface."""

    _internal: _LeaseInternal
    _now: Callable[[], int]
    _on_change: Callable[[], None]
    _released: bool = False

    @property
    def id(self) -> str:
        return self._internal.id

    @property
    def resource(self) -> ResourceId:
        return self._internal.resource

    @property
    def owner(self) -> str:
        return self._internal.owner

    @property
    def priority(self) -> ResourcePriority:
        return self._internal.priority

    @property
    def residency(self) -> ResidencyClass:
        return self._internal.residency

    @property
    def acquired_at(self) -> int:
        return self._internal.acquired_at

    @property
    def ttl_ms(self) -> int:
        return self._internal.ttl_ms

    @property
    def released(self) -> bool:
        return self._released or self._internal.released

    def renew(self, ttl_ms: int | None = None) -> int:
        if self.released:
            raise RuntimeError(f"Lease {self.id} is already released")
        # TTL is relative to now() — a renew resets the expiry clock so
        # the lease survives another full TTL window from this moment.
        self._internal.acquired_at = self._now()
        self._internal.ttl_ms = ttl_ms if ttl_ms is not None else _residency_ttl_ms(self._internal.residency)
        self._on_change()
        return self._internal.ttl_ms

    def release(self) -> None:
        if self.released:
            return
        self._released = True
        self._internal.released = True
        self._on_change()


class VoiceResourceScheduler:
    """Python port of the TypeScript `VoiceResourceScheduler`.

    Pure-logic scheduler that owns resource leases, applies priority
    ordering for preemption, and emits eviction events under memory
    or thermal pressure. The host supplies `PlatformSignals` to feed
    the actual observations; without it the scheduler runs in a
    "nominal" mode that only honours TTL expiry.

    No I/O, no logging of resource content (ADR-067). All eviction
    events are logged at INFO with provider-id and resource-kind,
    not with user-visible text.
    """

    def __init__(
        self,
        *,
        mode: str = "desktop",
        gpu_owned_by: str = "none",
        platform: PlatformSignals | None = None,
        now: Callable[[], int] | None = None,
        random_id: Callable[[], str] | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._now = now or (lambda: int(time.time() * 1000))
        self._random_id = random_id or (lambda: uuid.uuid4().hex[:8])
        self._mode = mode
        self._gpu_owned_by = gpu_owned_by
        self._platform = platform
        self._logger = logger or logging.getLogger("voice_host.resource_scheduler")
        # Leases are indexed by lease id (for direct eviction); the
        # `_resource_index` keeps a resourceKey → lease id pointer so
        # `acquire` and `find` stay O(1).
        self._leases: dict[str, _LeaseInternal] = {}
        self._resource_index: dict[str, str] = {}
        self._eviction_listeners: list[Callable[[EvictionEvent], None]] = []
        self._memory_state: MemoryPressureState = MemoryPressureState.NOMINAL
        self._thermal_status: ThermalStatus = ThermalStatus.NONE
        # Monotonic counter so lease ids stay unique even when the
        # host injects a fixed random_id (e.g. `lambda: "abc"` in tests).
        self._lease_counter = 0

    @property
    def gpu_disabled(self) -> bool:
        """ADR-074 §4: desktop + local-llm-owned GPU = no Voice VRAM."""
        return self._mode == "desktop" and self._gpu_owned_by == "local-llm"

    # -- read helpers --------------------------------------------------------

    def list(self) -> list[_LeaseHandle]:
        evictions = self._evict_expired()
        self._emit(evictions)
        return [
            _LeaseHandle(internal, self._now, self._on_change)
            for internal in self._leases.values()
            if not internal.released
        ]

    def find(self, resource: ResourceId) -> _LeaseHandle | None:
        evictions = self._evict_expired()
        self._emit(evictions)
        lease_id = self._resource_index.get(resource.key())
        internal = self._leases.get(lease_id) if lease_id else None
        if internal is None or internal.released:
            return None
        return _LeaseHandle(internal, self._now, self._on_change)

    # -- acquisition ---------------------------------------------------------

    def acquire(
        self,
        resource: ResourceId,
        owner: str,
        priority: ResourcePriority,
        residency: ResidencyClass,
        ttl_ms: int | None = None,
    ) -> _LeaseHandle | None:
        evictions = self._evict_expired()
        self._emit(evictions)
        existing_id = self._resource_index.get(resource.key())
        existing = self._leases.get(existing_id) if existing_id else None
        if existing is not None and not existing.released:
            if priority_weight(priority) <= priority_weight(existing.priority):
                # Existing holder outranks the request — cannot preempt.
                return None
            # New request outranks the existing holder — preempt.
            self._emit(self._evict_by_ids([existing.id], EvictionReason.EXPLICIT_RELEASE))
        lease_id = f"lease_{self._lease_counter}_{self._random_id()}"
        self._lease_counter += 1
        internal = _LeaseInternal(
            id=lease_id,
            resource=resource,
            owner=owner,
            priority=priority,
            residency=residency,
            acquired_at=self._now(),
            ttl_ms=ttl_ms if ttl_ms is not None else _residency_ttl_ms(residency),
        )
        self._leases[lease_id] = internal
        self._resource_index[resource.key()] = lease_id
        return _LeaseHandle(internal, self._now, self._on_change)

    # -- eviction reports ----------------------------------------------------

    def report_memory_pressure(
        self,
        state: MemoryPressureState,
        *,
        free_bytes: int | None = None,
        target_bytes: int | None = None,
    ) -> list[EvictionEvent]:
        self._memory_state = state
        expired = self._evict_expired()
        evicted = self._evict_by_pressure(state, thermal=False)
        all_events = [*expired, *evicted]
        self._emit(all_events)
        return all_events

    def report_thermal(self, status: ThermalStatus) -> list[EvictionEvent]:
        self._thermal_status = status
        expired = self._evict_expired()
        evicted = self._evict_by_pressure(status, thermal=True)
        all_events = [*expired, *evicted]
        self._emit(all_events)
        return all_events

    def on_eviction(self, listener: Callable[[EvictionEvent], None]) -> Callable[[], None]:
        self._eviction_listeners.append(listener)

        def unsubscribe() -> None:
            if listener in self._eviction_listeners:
                self._eviction_listeners.remove(listener)

        return unsubscribe

    # -- introspection -------------------------------------------------------

    def diagnostics(self) -> dict[str, object]:
        return {
            "mode": self._mode,
            "voice_gpu_alloc_bytes": 0,
            "gpu_owned_by": self._gpu_owned_by,
            "thermal": self._thermal_status.value,
            "memory": self._memory_state.value,
            "platform_connected": self._platform is not None,
        }

    # -- internal eviction machinery ----------------------------------------

    def _on_change(self) -> None:
        evictions = self._evict_expired()
        self._emit(evictions)

    def _emit(self, evictions: Iterable[EvictionEvent]) -> None:
        for event in evictions:
            for listener in list(self._eviction_listeners):
                try:
                    listener(event)
                except Exception:  # noqa: BLE001 — listeners must not break the scheduler
                    self._logger.exception("eviction listener raised")
            self._logger.info(
                "voice.resource.evicted",
                extra={
                    "lease_id": event.lease_id,
                    "owner": event.owner,
                    "kind": event.resource.kind,
                    "language": event.resource.language,
                    "reason": event.reason.value,
                },
            )

    def _evict_by_ids(
        self,
        lease_ids: Iterable[str],
        reason: EvictionReason,
    ) -> list[EvictionEvent]:
        observed_at = self._now()
        events: list[EvictionEvent] = []
        for lease_id in lease_ids:
            internal = self._leases.get(lease_id)
            if internal is None or internal.released:
                continue
            internal.released = True
            self._leases.pop(lease_id, None)
            self._resource_index.pop(internal.resource.key(), None)
            events.append(
                EvictionEvent(
                    lease_id=lease_id,
                    resource=internal.resource,
                    owner=internal.owner,
                    reason=reason,
                    observed_at=observed_at,
                )
            )
        return events

    def _evict_expired(self) -> list[EvictionEvent]:
        observed_at = self._now()
        expired = [
            internal.id
            for internal in self._leases.values()
            if not internal.released and observed_at - internal.acquired_at >= internal.ttl_ms
        ]
        return self._evict_by_ids(expired, EvictionReason.TTL_EXPIRED)

    def _evict_by_pressure(
        self,
        state: MemoryPressureState | ThermalStatus,
        *,
        thermal: bool,
    ) -> list[EvictionEvent]:
        if thermal:
            due = state in {
                ThermalStatus.SEVERE,
                ThermalStatus.CRITICAL,
                ThermalStatus.EMERGENCY,
                ThermalStatus.SHUTDOWN,
            }
        else:
            due = state in {
                MemoryPressureState.MODERATE,
                MemoryPressureState.CRITICAL,
                MemoryPressureState.LOW_MEMORY,
            }
        if not due:
            return []
        to_evict: list[str] = []
        # Walk leases from lowest priority to highest.
        sorted_leases = sorted(
            (lease for lease in self._leases.values() if not lease.released),
            key=lambda lease: priority_weight(lease.priority),
        )
        for lease in sorted_leases:
            # realtime-audio is never evicted under any pressure (ADR-074 §2).
            if lease.priority == ResourcePriority.REALTIME_AUDIO:
                continue
            if thermal:
                if lease.priority == ResourcePriority.PRELOAD:
                    to_evict.append(lease.id)
                elif state in {
                    ThermalStatus.CRITICAL,
                    ThermalStatus.EMERGENCY,
                    ThermalStatus.SHUTDOWN,
                }:
                    if (
                        lease.priority != ResourcePriority.VAD_AEC
                        and lease.residency != ResidencyClass.KEEP_WARM
                    ):
                        to_evict.append(lease.id)
            else:
                if lease.priority == ResourcePriority.PRELOAD:
                    to_evict.append(lease.id)
                elif state in {MemoryPressureState.CRITICAL, MemoryPressureState.LOW_MEMORY}:
                    if lease.residency in {ResidencyClass.PRELOAD, ResidencyClass.IDLE_EVICT}:
                        to_evict.append(lease.id)
        return self._evict_by_ids(to_evict, EvictionReason.THERMAL_PRESSURE if thermal else EvictionReason.MEMORY_PRESSURE)


def would_preempt(
    scheduler: VoiceResourceScheduler,
    resource: ResourceId,
    priority: ResourcePriority,
) -> bool:
    """True if `priority` would preempt the active holder of `resource`."""
    existing = scheduler.find(resource)
    if existing is None:
        return True
    return priority_weight(priority) > priority_weight(existing.priority)
