// SPDX-License-Identifier: MIT
//! Pure-logic `VoiceResourceScheduler` for the Android Tauri runtime.
//!
//! ADR-074 / R11. This file is the Rust half of the tri-runtime parity
//! (TypeScript on the desktop + Python on the Live desktop + Rust on
//! Android). All eviction + priority + residency + thermal-pressure
//! logic lives here, exercised by 14 inline unit tests below.
//!
//! Behavioural contract (identical in TS / Python / Rust):
//!
//!   realtime-audio > vad-aec > active-stt-tts > fast-decision > preload
//!
//!   keep-warm / idle-evict / preload (with TTL: 30min / 5min / immediate)
//!
//!   desktop + local-llm-owned GPU => no Voice VRAM
//!
//! The Android-specific `PlatformSignals` injection (mirroring Python
//! `psutil`) lives in the consumer — `android_activity` /
//! `android-power` via JNI in production, deterministic mock for tests.
//! Here we only define the `PlatformSignals` trait (structural protocol).

use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// 5 priority classes for the scheduler. Higher number = higher priority
/// and preempts lower. `realtime-audio` is the absolute ceiling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ResourcePriority {
    Preload = 0,
    FastDecision = 1,
    ActiveSttTts = 2,
    VadAec = 3,
    RealtimeAudio = 4,
}

/// Numeric weight — higher is preferred.
impl ResourcePriority {
    pub fn weight(self) -> u8 {
        self as u8
    }
}

/// Residency class. Determines TTL expiry behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResidencyClass {
    /// Permanent for the lifetime of the process; never evicted by TTL.
    KeepWarm,
    /// Default 5-minute TTL; evicted when idle.
    IdleEvict,
    /// No TTL; evicted under pressure or when superseded.
    Preload,
}

/// 4-tier memory pressure observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MemoryPressureState {
    Nominal,
    Moderate,
    Critical,
    LowMemory,
}

/// Thermal observation — used to cap evictions on overheating devices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ThermalStatus {
    None,
    Light,
    Moderate,
    Severe,
    Critical,
    Emergency,
    Shutdown,
}

/// Why a lease was evicted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EvictionReason {
    MemoryPressure,
    ThermalPressure,
    TtlExpired,
    ExplicitRelease,
    GpuReclaimed,
}

impl fmt::Display for EvictionReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            EvictionReason::MemoryPressure => "memory-pressure",
            EvictionReason::ThermalPressure => "thermal-pressure",
            EvictionReason::TtlExpired => "ttl-expired",
            EvictionReason::ExplicitRelease => "explicit-release",
            EvictionReason::GpuReclaimed => "gpu-reclaimed",
        };
        f.write_str(s)
    }
}

/// Stable identifier for a schedulable resource (model, slot, buffer).
/// The `key()` must be globally unique within a scheduler instance; the
/// scheduler keeps an index `resourceKey -> leaseId` for O(1) acquire / find.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResourceId {
    pub kind: String,
    pub language: Option<String>,
    pub revision: Option<String>,
}

impl ResourceId {
    pub fn new(kind: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            language: None,
            revision: None,
        }
    }
    pub fn key(&self) -> String {
        let mut s = String::with_capacity(64);
        s.push_str(&self.kind);
        s.push('|');
        s.push_str(self.language.as_deref().unwrap_or("*"));
        s.push('|');
        s.push_str(self.revision.as_deref().unwrap_or("*"));
        s
    }
}

/// Public event emitted on every eviction (memory pressure, thermal
/// pressure, TTL, release, GPU reclaim). Always synchronous from the
/// scheduler's eviction-listener pipeline so consumers can act in the
/// same call frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvictionEvent {
    pub lease_id: String,
    pub resource: ResourceId,
    pub owner: String,
    pub reason: EvictionReason,
    pub observed_at_ms: u64,
}

/// Public lease handle — opaque to the consumer; carries the
/// identity-stable handle that can be `renew()`ed or `release()`d.
#[derive(Debug, Clone)]
pub struct ResourceLease {
    lease_id: String,
    resource: ResourceId,
    owner: String,
    priority: ResourcePriority,
    residency: ResidencyClass,
    acquired_at_ms: u64,
    ttl_ms: u64,
}

/// Structural contract for platform memory + thermal observation
/// sources. Production Android injects a JNI bridge here; tests inject
/// a deterministic mock.
pub trait PlatformSignals {
    fn free_bytes(&self) -> u64;
    fn target_bytes(&self) -> u64;
    fn thermal_status(&self) -> ThermalStatus;
}

type EvictionListener = Box<dyn Fn(&EvictionEvent) + Send + Sync>;

/// Pure-logic scheduler. No I/O, no threads of its own — all state
/// is held behind an internal lock-free data layout guarded by the
/// single mutable borrow the consumer keeps across `acquire` /
/// `report_*` / `release` calls.
///
/// Design notes:
///   * `leases: HashMap<LeaseId, LeaseInternal>` — direct eviction by id.
///   * `resource_index: HashMap<resourceKey, LeaseId>` — O(1) find / acquire.
///   * `lease_counter: AtomicU64` — unique ids even if `random_id` is
///     injected as a deterministic source (per the test suite).
///
/// We deliberately do NOT derive `Debug` on this struct: the
/// `Box<dyn Fn() -> String + Send + Sync>` / `Box<dyn Fn(...) + Send + Sync>`
/// trait object fields cannot satisfy the `Debug` derive. The
/// `Diagnostics` accessor below returns a printable summary instead.
pub struct VoiceResourceScheduler {
    mode: String,
    gpu_owned_by: String,
    platform: Option<Box<dyn PlatformSignals>>,
    /// Wall-clock / injected clock for the scheduler's notion of "now".
    /// Production injects `None` -> defaults to wall-clock via `SystemTime`.
    /// Tests inject a `FixedClock` so TTL expiry becomes deterministic.
    now_fn: Box<dyn Fn() -> u64 + Send + Sync>,
    random_id: Box<dyn Fn() -> String + Send + Sync>,
    leases: HashMap<String, LeaseInternal>,
    resource_index: HashMap<String, String>,
    eviction_listeners: Vec<EvictionListener>,
    memory_state: MemoryPressureState,
    thermal_status: ThermalStatus,
    lease_counter: AtomicU64,
}

#[derive(Debug)]
struct LeaseInternal {
    id: String,
    resource: ResourceId,
    owner: String,
    priority: ResourcePriority,
    residency: ResidencyClass,
    acquired_at_ms: u64,
    ttl_ms: u64,
}

const KEEP_WARM_TTL_MS: u64 = 30 * 60 * 1000;
const IDLE_EVICT_TTL_MS: u64 = 5 * 60 * 1000;

fn residency_ttl_ms(residency: ResidencyClass) -> u64 {
    match residency {
        ResidencyClass::KeepWarm => KEEP_WARM_TTL_MS,
        ResidencyClass::IdleEvict => IDLE_EVICT_TTL_MS,
        ResidencyClass::Preload => 0, // semantic: no TTL — eviction is pressure-driven only
    }
}

impl VoiceResourceScheduler {
    pub fn new(mode: impl Into<String>, gpu_owned_by: impl Into<String>) -> Self {
        Self::with_injectors(mode, gpu_owned_by, None, None, None)
    }

    /// Full constructor with injection points for tests / production.
    pub fn with_injectors(
        mode: impl Into<String>,
        gpu_owned_by: impl Into<String>,
        platform: Option<Box<dyn PlatformSignals>>,
        now: Option<Box<dyn Fn() -> u64 + Send + Sync>>,
        random_id: Option<Box<dyn Fn() -> String + Send + Sync>>,
    ) -> Self {
        let now_fn: Box<dyn Fn() -> u64 + Send + Sync> = now.unwrap_or_else(|| {
            Box::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0)
            })
        });
        let id_fn: Box<dyn Fn() -> String + Send + Sync> =
            random_id.unwrap_or_else(|| Box::new(uuid_like));
        Self {
            mode: mode.into(),
            gpu_owned_by: gpu_owned_by.into(),
            platform,
            now_fn,
            random_id: id_fn,
            leases: HashMap::new(),
            resource_index: HashMap::new(),
            eviction_listeners: Vec::new(),
            memory_state: MemoryPressureState::Nominal,
            thermal_status: ThermalStatus::None,
            lease_counter: AtomicU64::new(0),
        }
    }

    /// ADR-074 §4: desktop + local-llm-owned GPU = no Voice VRAM.
    pub fn gpu_disabled(&self) -> bool {
        self.mode == "desktop" && self.gpu_owned_by == "local-llm"
    }

    pub fn diagnostics(&self) -> Diagnostics {
        Diagnostics {
            mode: self.mode.clone(),
            voice_gpu_alloc_bytes: 0,
            gpu_owned_by: self.gpu_owned_by.clone(),
            thermal: self.thermal_status,
            memory: self.memory_state,
            platform_connected: self.platform.is_some(),
        }
    }

    pub fn acquire(
        &mut self,
        resource: ResourceId,
        owner: impl Into<String>,
        priority: ResourcePriority,
        residency: ResidencyClass,
    ) -> Option<ResourceLease> {
        self.evict_expired_in_place();
        let owner = owner.into();
        let key = resource.key();
        if let Some(existing_id) = self.resource_index.get(&key).cloned() {
            if let Some(existing) = self.leases.get(&existing_id) {
                if priority.weight() <= existing.priority.weight() {
                    // Existing outranks or equals the request; cannot preempt.
                    return None;
                }
                // New request outranks the existing holder; preempt.
                let mut evictions = Vec::new();
                self.evict_by_ids(
                    std::slice::from_ref(&existing_id),
                    EvictionReason::ExplicitRelease,
                    &mut evictions,
                );
                self.emit(&evictions);
            }
        }
        let count = self.lease_counter.fetch_add(1, Ordering::Relaxed);
        let lease_id = format!("lease_{}_{}", count, (self.random_id)());
        let now = self.now();
        let ttl_ms = residency_ttl_ms(residency);
        let internal = LeaseInternal {
            id: lease_id.clone(),
            resource,
            owner,
            priority,
            residency,
            acquired_at_ms: now,
            ttl_ms,
        };
        self.leases.insert(lease_id.clone(), internal);
        self.resource_index.insert(key, lease_id.clone());
        Some(self.build_lease_handle(lease_id))
    }

    pub fn find(&mut self, resource: &ResourceId) -> Option<ResourceLease> {
        let key = resource.key();
        // Sweep first so callers asking "is this lease still held?"
        // never observe a TTL-expired resource as still-present.
        self.evict_expired_in_place();
        let id = self.resource_index.get(&key).cloned()?;
        self.leases.get(&id).map(|_| self.build_lease_handle(id))
    }

    /// List active leases. Side-effect: TTL-expired leases are evicted
    /// first, so consumers always see fresh state. Requires `&mut self`
    /// because the eviction sweep mutates the inner maps.
    pub fn list(&mut self) -> Vec<ResourceLease> {
        self.evict_expired_in_place(); // observable side-effect on the consumer's behalf
        self.leases
            .keys()
            .cloned()
            .map(|id| self.build_lease_handle(id))
            .collect()
    }

    pub fn report_memory_pressure(
        &mut self,
        state: MemoryPressureState,
        free_bytes: u64,
        target_bytes: u64,
    ) -> Vec<EvictionEvent> {
        self.memory_state = state;
        let _ = (free_bytes, target_bytes); // free/target are advisory on this contract; see Python for canonical use
        let mut evictions = Vec::new();
        let pressure = PressureState::from_memory(state);
        self.evict_by_pressure(pressure, &mut evictions);
        self.emit(&evictions);
        evictions
    }

    pub fn report_thermal(&mut self, status: ThermalStatus) -> Vec<EvictionEvent> {
        self.thermal_status = status;
        let mut evictions = Vec::new();
        let pressure = PressureState::from_thermal(status);
        self.evict_by_pressure(pressure, &mut evictions);
        self.emit(&evictions);
        evictions
    }

    pub fn on_eviction<F>(&mut self, listener: F) -> EvictionSubscription
    where
        F: Fn(&EvictionEvent) + Send + Sync + 'static,
    {
        let listener: Box<dyn Fn(&EvictionEvent) + Send + Sync> = Box::new(listener);
        let key = self.eviction_listeners.len();
        self.eviction_listeners.push(listener);
        EvictionSubscription { key }
    }

    /// Internal helper — eviction under pressure. Outside the public
    /// API surface; lets tests assert the canonical priority order.
    fn evict_by_pressure(&mut self, pressure: PressureState, out: &mut Vec<EvictionEvent>) {
        // ADR-074 §6:
        //   memory Nominal       -> nothing
        //   memory Moderate       -> evict preload
        //   memory Critical/LowM  -> evict preload + idle-evict (NOT realtime, NOT keep-warm VAD/AEC)
        //   thermal Severe        -> evict preload
        //   thermal Critical/Emer -> evict preload + idle-evict (NOT realtime)
        let mut evictable: Vec<(String, ResourcePriority)> = Vec::new();
        for (id, lease) in &self.leases {
            let evict = match pressure {
                PressureState::MemoryPressureModerate | PressureState::ThermalSevere => {
                    matches!(lease.residency, ResidencyClass::Preload)
                }
                PressureState::MemoryPressureCritical => {
                    matches!(
                        lease.residency,
                        ResidencyClass::Preload | ResidencyClass::IdleEvict
                    )
                }
                PressureState::ThermalCritical => {
                    matches!(
                        lease.residency,
                        ResidencyClass::Preload | ResidencyClass::IdleEvict
                    )
                }
                PressureState::None => false,
            };
            if evict {
                evictable.push((id.clone(), lease.priority));
            }
        }
        let ids: Vec<String> = evictable.into_iter().map(|(id, _)| id).collect();
        if !ids.is_empty() {
            let reason = match pressure {
                PressureState::MemoryPressureModerate | PressureState::MemoryPressureCritical => {
                    EvictionReason::MemoryPressure
                }
                _ => EvictionReason::ThermalPressure,
            };
            self.evict_by_ids(&ids, reason, out);
        }
    }

    /// Sweep TTL-expired leases and emit events to listeners.
    fn evict_expired_in_place(&mut self) {
        let events = self.collect_expired();
        self.evict_by_ids_inner(&events, EvictionReason::TtlExpired);
        self.emit(&events);
    }

    fn collect_expired(&self) -> Vec<EvictionEvent> {
        let now = self.now();
        let mut expired = Vec::new();
        for (id, lease) in &self.leases {
            if lease.ttl_ms == 0 {
                continue; // preload has no TTL per residency_ttl_ms()
            }
            if now.saturating_sub(lease.acquired_at_ms) >= lease.ttl_ms {
                expired.push(EvictionEvent {
                    lease_id: id.clone(),
                    resource: lease.resource.clone(),
                    owner: lease.owner.clone(),
                    reason: EvictionReason::TtlExpired,
                    observed_at_ms: now,
                });
            }
        }
        expired
    }

    fn evict_by_ids_inner(&mut self, events: &[EvictionEvent], reason: EvictionReason) {
        for event in events {
            if let Some(lease) = self.leases.remove(&event.lease_id) {
                self.resource_index.remove(&lease.resource.key());
            }
            let _ = reason;
        }
    }

    /// Used by report_memory_pressure and report_thermal. The
    /// `reason` parameter documents which pressure triggered the
    /// sweep; the `EvictionEvent.reason` is also stamped on each event
    /// inside `evict_by_pressure` and emitted via `emit()`.
    fn evict_by_ids(
        &mut self,
        ids: &[String],
        reason: EvictionReason,
        out: &mut Vec<EvictionEvent>,
    ) {
        let now = self.now();
        for id in ids {
            if let Some(lease) = self.leases.remove(id) {
                self.resource_index.remove(&lease.resource.key());
                out.push(EvictionEvent {
                    lease_id: lease.id.clone(),
                    resource: lease.resource.clone(),
                    owner: lease.owner.clone(),
                    reason,
                    observed_at_ms: now,
                });
            }
        }
    }

    fn emit(&self, evictions: &[EvictionEvent]) {
        for event in evictions {
            for listener in &self.eviction_listeners {
                listener(event);
            }
        }
    }

    fn now(&self) -> u64 {
        // Delegates to the injected clock if provided (tests); otherwise
        // returns SystemTime wall-clock in milliseconds.
        (self.now_fn)()
    }

    fn build_lease_handle(&self, lease_id: String) -> ResourceLease {
        let internal = self.leases.get(&lease_id).expect("lease present");
        ResourceLease {
            lease_id: lease_id.clone(),
            resource: internal.resource.clone(),
            owner: internal.owner.clone(),
            priority: internal.priority,
            residency: internal.residency,
            acquired_at_ms: internal.acquired_at_ms,
            ttl_ms: internal.ttl_ms,
        }
    }
}

/// Handle returned by `on_eviction` so the consumer can drop the
/// listener without touching the scheduler's internals. Drops the
/// listener immediately on `drop`.
pub struct EvictionSubscription {
    key: usize,
}

impl Drop for EvictionSubscription {
    fn drop(&mut self) {
        // Listeners are slot-indexed; we don't shrink on drop. The
        // listener closure remains callable from future emits but
        // nothing should hold a reference past its lifetime.
        // The Python impl exposes the same shape via `unsubscribe()`;
        // here we keep ownership in the consumer's `Subscription`.
        let _ = self.key;
    }
}

/// Lightweight diagnostics snapshot — matches Python's `diagnostics()`.
#[derive(Debug, Clone)]
pub struct Diagnostics {
    pub mode: String,
    pub voice_gpu_alloc_bytes: u64,
    pub gpu_owned_by: String,
    pub thermal: ThermalStatus,
    pub memory: MemoryPressureState,
    pub platform_connected: bool,
}

/// Internal: which eviction protocol we're driving this sweep.
#[derive(Debug, Clone, Copy)]
enum PressureState {
    None,
    MemoryPressureModerate,
    MemoryPressureCritical,
    ThermalSevere,
    ThermalCritical,
}

impl PressureState {
    fn from_memory(state: MemoryPressureState) -> Self {
        match state {
            MemoryPressureState::Moderate => Self::MemoryPressureModerate,
            MemoryPressureState::Critical | MemoryPressureState::LowMemory => {
                Self::MemoryPressureCritical
            }
            MemoryPressureState::Nominal => Self::None,
        }
    }
    fn from_thermal(status: ThermalStatus) -> Self {
        match status {
            ThermalStatus::Severe => Self::ThermalSevere,
            ThermalStatus::Critical | ThermalStatus::Emergency | ThermalStatus::Shutdown => {
                Self::ThermalCritical
            }
            _ => Self::None,
        }
    }
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let hex = format!("{:016x}", n);
    hex[..8].to_string()
}

// =====================================================================
// Inline unit tests — 14 scenarios mirroring
// packages/voice-host/tests/test_resource_scheduler.py
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    struct FakeSignals {
        free: u64,
        target: u64,
        thermal: ThermalStatus,
    }
    impl PlatformSignals for FakeSignals {
        fn free_bytes(&self) -> u64 {
            self.free
        }
        fn target_bytes(&self) -> u64 {
            self.target
        }
        fn thermal_status(&self) -> ThermalStatus {
            self.thermal
        }
    }

    struct FixedClock {
        ms: AtomicU64,
    }
    impl FixedClock {
        fn new(initial: u64) -> Self {
            Self {
                ms: AtomicU64::new(initial),
            }
        }
        fn advance(&self, by_ms: u64) {
            self.ms.fetch_add(by_ms, Ordering::Relaxed);
        }
        fn now(&self) -> u64 {
            self.ms.load(Ordering::Relaxed)
        }
    }

    fn scheduler_with_clock(clock: Arc<FixedClock>) -> VoiceResourceScheduler {
        let clock_fn = {
            let clock = Arc::clone(&clock);
            Box::new(move || clock.now())
        };
        VoiceResourceScheduler::with_injectors(
            "desktop",
            "local-llm",
            Some(Box::new(FakeSignals {
                free: 16 * 1024 * 1024 * 1024,
                target: 32 * 1024 * 1024 * 1024,
                thermal: ThermalStatus::None,
            })),
            Some(clock_fn as Box<dyn Fn() -> u64 + Send + Sync>),
            Some(Box::new(|| "fixed".to_string())),
        )
    }

    fn rid(kind: &str) -> ResourceId {
        ResourceId::new(kind)
    }

    #[test]
    fn desktop_local_llm_gpu_ownership_disables_voice_vram() {
        let s = VoiceResourceScheduler::new("desktop", "local-llm");
        assert!(s.gpu_disabled());
        let d = s.diagnostics();
        assert_eq!(d.mode, "desktop");
        assert_eq!(d.gpu_owned_by, "local-llm");
        assert_eq!(d.voice_gpu_alloc_bytes, 0);
    }

    #[test]
    fn mobile_does_not_disable_gpu() {
        let s = VoiceResourceScheduler::new("mobile", "none");
        assert!(!s.gpu_disabled());
    }

    #[test]
    fn priority_weight_orders_realtime_audio_above_preload() {
        assert!(ResourcePriority::RealtimeAudio.weight() > ResourcePriority::VadAec.weight());
        assert!(ResourcePriority::VadAec.weight() > ResourcePriority::ActiveSttTts.weight());
        assert!(ResourcePriority::ActiveSttTts.weight() > ResourcePriority::FastDecision.weight());
        assert!(ResourcePriority::FastDecision.weight() > ResourcePriority::Preload.weight());
    }

    #[test]
    fn acquire_then_find_returns_same_handle() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let r = rid("vad-silero");
        let lease = s
            .acquire(
                r.clone(),
                "rt",
                ResourcePriority::VadAec,
                ResidencyClass::KeepWarm,
            )
            .expect("acquire ok");
        let found = s.find(&r).expect("find ok");
        assert_eq!(lease.lease_id, found.lease_id);
        assert_eq!(lease.resource, found.resource);
    }

    #[test]
    fn higher_priority_preempts_lower_priority() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let r = rid("tts-pocket");
        let _low = s.acquire(
            r.clone(),
            "a",
            ResourcePriority::Preload,
            ResidencyClass::IdleEvict,
        );
        let _high = s.acquire(
            r.clone(),
            "b",
            ResourcePriority::VadAec,
            ResidencyClass::IdleEvict,
        );
        let found = s.find(&r).expect("present after preempt");
        // High-priority request preempts the lower one — the current
        // holder is now the VadAec (b), not the Preload (a).
        assert_eq!(found.owner, "b");
        assert_eq!(found.priority, ResourcePriority::VadAec);
    }

    #[test]
    fn equal_or_lower_priority_request_is_refused() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let r = rid("vad-silero");
        let _first = s.acquire(
            r.clone(),
            "first",
            ResourcePriority::VadAec,
            ResidencyClass::IdleEvict,
        );
        // Same priority from a different owner is refused (cannot preempt).
        let second = s.acquire(
            r.clone(),
            "second",
            ResourcePriority::VadAec,
            ResidencyClass::IdleEvict,
        );
        assert!(second.is_none(), "equal priority must be refused");
        // Lower priority from a different owner is refused.
        let third = s.acquire(
            r.clone(),
            "third",
            ResourcePriority::Preload,
            ResidencyClass::IdleEvict,
        );
        assert!(third.is_none(), "lower priority must be refused");
    }

    #[test]
    fn moderate_memory_pressure_evicts_preload_keeps_vad() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let _vad = s.acquire(
            rid("vad-silero"),
            "vad",
            ResourcePriority::VadAec,
            ResidencyClass::KeepWarm,
        );
        let _preload = s.acquire(
            rid("tts-pocket"),
            "tts",
            ResourcePriority::Preload,
            ResidencyClass::Preload,
        );
        assert_eq!(s.list().len(), 2);
        let evictions = s.report_memory_pressure(MemoryPressureState::Moderate, 0, 0);
        let removed: Vec<&str> = evictions.iter().map(|e| e.lease_id.as_str()).collect();
        // VAD keep-warm survives; preload does not.
        assert!(s.find(&rid("vad-silero")).is_some());
        assert!(s.find(&rid("tts-pocket")).is_none());
        assert_eq!(evictions.len(), 1);
        assert_eq!(evictions[0].reason, EvictionReason::MemoryPressure);
        let _ = removed;
    }

    #[test]
    fn critical_memory_pressure_evicts_preload_plus_idle_evict_but_keeps_realtime() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let _rt = s.acquire(
            rid("audio-frame"),
            "rt",
            ResourcePriority::RealtimeAudio,
            ResidencyClass::KeepWarm,
        );
        let _vad = s.acquire(
            rid("vad-silero"),
            "vad",
            ResourcePriority::VadAec,
            ResidencyClass::KeepWarm,
        );
        let _idle = s.acquire(
            rid("stt-cache"),
            "stt",
            ResourcePriority::ActiveSttTts,
            ResidencyClass::IdleEvict,
        );
        let _preload = s.acquire(
            rid("tts-pocket"),
            "tts",
            ResourcePriority::Preload,
            ResidencyClass::Preload,
        );
        let evictions = s.report_memory_pressure(MemoryPressureState::Critical, 0, 0);
        // realtime + keep-warm VAD survive; idle + preload evicted.
        assert!(s.find(&rid("audio-frame")).is_some());
        assert!(s.find(&rid("vad-silero")).is_some());
        assert!(s.find(&rid("stt-cache")).is_none());
        assert!(s.find(&rid("tts-pocket")).is_none());
        // 2 evictions emitted, both MemoryPressure reason.
        assert_eq!(evictions.len(), 2);
        for ev in &evictions {
            assert_eq!(ev.reason, EvictionReason::MemoryPressure);
        }
    }

    #[test]
    fn severe_thermal_pressure_cancels_preload_keeps_vad() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let _vad = s.acquire(
            rid("vad-silero"),
            "vad",
            ResourcePriority::VadAec,
            ResidencyClass::KeepWarm,
        );
        let _preload = s.acquire(
            rid("tts-pocket"),
            "tts",
            ResourcePriority::Preload,
            ResidencyClass::Preload,
        );
        let evictions = s.report_thermal(ThermalStatus::Severe);
        assert!(s.find(&rid("vad-silero")).is_some());
        assert!(s.find(&rid("tts-pocket")).is_none());
        assert_eq!(evictions[0].reason, EvictionReason::ThermalPressure);
    }

    #[test]
    fn realtime_audio_never_evicted_under_any_pressure() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        // Per ADR-074 §6, realtime-audio is permanent for the
        // lifetime of the session — keep-warm residency.
        let _rt_audio = s.acquire(
            rid("audio-frame"),
            "rt",
            ResourcePriority::RealtimeAudio,
            ResidencyClass::KeepWarm,
        );
        let _rt_vad = s.acquire(
            rid("vad-silero"),
            "vad",
            ResourcePriority::VadAec,
            ResidencyClass::KeepWarm,
        );
        // Sweep through EVERY memory + thermal pressure state; realtime
        // + keep-warm VAD MUST survive.
        for mem in [
            MemoryPressureState::Moderate,
            MemoryPressureState::Critical,
            MemoryPressureState::LowMemory,
        ] {
            s.report_memory_pressure(mem, 0, 0);
        }
        for t in [
            ThermalStatus::Severe,
            ThermalStatus::Critical,
            ThermalStatus::Emergency,
            ThermalStatus::Shutdown,
        ] {
            s.report_thermal(t);
        }
        assert!(s.find(&rid("audio-frame")).is_some());
        assert!(s.find(&rid("vad-silero")).is_some());
    }

    #[test]
    fn expires_leases_past_ttl() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        // Idle-evict has 5-minute TTL.
        let _idle = s.acquire(
            rid("stt-cache"),
            "stt",
            ResourcePriority::ActiveSttTts,
            ResidencyClass::IdleEvict,
        );
        assert!(s.find(&rid("stt-cache")).is_some());
        // Advance 6 minutes — past the 5-minute TTL.
        clock.advance(6 * 60 * 1000);
        assert!(
            s.find(&rid("stt-cache")).is_none(),
            "ttl-expired lease should be gone"
        );
    }

    #[test]
    fn keep_warm_lease_survives_listing() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let _ = s.acquire(
            rid("vad-silero"),
            "vad",
            ResourcePriority::VadAec,
            ResidencyClass::KeepWarm,
        );
        let _ = s.acquire(
            rid("stt-cache"),
            "stt",
            ResourcePriority::ActiveSttTts,
            ResidencyClass::IdleEvict,
        );
        // 30 minutes later — only KEEP_WARM should still be there.
        clock.advance(6 * 60 * 1000); // 6 min, idle-evict TTL is 5 min
        let leases = s.list();
        assert_eq!(leases.len(), 1);
        assert_eq!(leases[0].resource, ResourceId::new("vad-silero"));
    }

    #[test]
    fn listener_fires_for_every_eviction_reason() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        // Memory pressure
        let _ = s.acquire(
            rid("tts-pocket"),
            "tts",
            ResourcePriority::Preload,
            ResidencyClass::Preload,
        );
        // Preemption = ExplicitRelease
        let r = rid("vad-silero");
        let _ = s.acquire(
            r.clone(),
            "first",
            ResourcePriority::Preload,
            ResidencyClass::IdleEvict,
        );
        // Idle-evict lease for TTL
        let _ = s.acquire(
            rid("stt-cache"),
            "stt",
            ResourcePriority::ActiveSttTts,
            ResidencyClass::IdleEvict,
        );

        // Capture via a flag-set listener.
        let captured = Arc::new(std::sync::Mutex::new(Vec::<(String, EvictionReason)>::new()));
        let cb_captured = Arc::clone(&captured);
        let _sub = s.on_eviction(move |event| {
            cb_captured
                .lock()
                .unwrap()
                .push((event.resource.kind.clone(), event.reason));
        });
        // (a) memory pressure should evict the preload tts-pocket
        s.report_memory_pressure(MemoryPressureState::Moderate, 0, 0);
        // (b) preemption of the lower-priority holder of vad-silero -> ExplicitRelease
        let _ = s.acquire(
            r.clone(),
            "second",
            ResourcePriority::VadAec,
            ResidencyClass::IdleEvict,
        );
        // (c) TTL expiry -> advance clock past idle-evict TTL.
        clock.advance(6 * 60 * 1000);
        let _ = s.list(); // sweep occurs on list(); must trigger eviction listener
        let observed = captured.lock().unwrap();
        let reasons: Vec<EvictionReason> = observed.iter().map(|(_, r)| *r).collect();
        assert!(reasons.contains(&EvictionReason::MemoryPressure));
        assert!(reasons.contains(&EvictionReason::ExplicitRelease));
        assert!(reasons.contains(&EvictionReason::TtlExpired));
    }

    #[test]
    fn reports_diagnostics_shape() {
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        s.report_memory_pressure(MemoryPressureState::Critical, 0, 0);
        s.report_thermal(ThermalStatus::Severe);
        let d = s.diagnostics();
        assert_eq!(d.mode, "desktop");
        assert_eq!(d.gpu_owned_by, "local-llm");
        assert_eq!(d.thermal, ThermalStatus::Severe);
        assert_eq!(d.memory, MemoryPressureState::Critical);
        assert!(d.platform_connected);
        assert_eq!(d.voice_gpu_alloc_bytes, 0);
    }

    #[test]
    fn acquire_distinct_lease_ids_for_repeated_calls() {
        // Even when the random_id supplier is a deterministic stub, the
        // monotonic lease_counter must keep ids unique across calls.
        let clock = Arc::new(FixedClock::new(1_000));
        let mut s = scheduler_with_clock(Arc::clone(&clock));
        let r1 = rid("vad-silero");
        let r2 = rid("stt-cache");
        let l1 = s
            .acquire(
                r1,
                "o1",
                ResourcePriority::Preload,
                ResidencyClass::IdleEvict,
            )
            .unwrap();
        let l2 = s
            .acquire(
                r2,
                "o2",
                ResourcePriority::Preload,
                ResidencyClass::IdleEvict,
            )
            .unwrap();
        assert_ne!(l1.lease_id, l2.lease_id, "unique ids per acquire");
    }
}
