// SPDX-License-Identifier: MIT
//! Voice Resource Scheduler — Rust mirror of the TypeScript + Python
//! implementations (ADR-074 / R11 plan §32).
//!
//! This module is the Android-Rust half of the contract shared with the
//! Python `voice_host.resource_scheduler` and the TypeScript
//! `packages/contracts/voice-resource-scheduler` modules. The three
//! implementations MUST stay behaviour-compatible: a lease acquired on
//! one runtime should round-trip through another for the same
//! (priority, residency, ttl_ms) and produce identical eviction
//! outcomes on identical event sequences.
//!
//! Pure logic, no I/O, no logging of resource content (ADR-067). Tests
//! are inline (`#[cfg(test)] mod tests`) and exercise the same
//! scenarios as `packages/voice-host/tests/test_resource_scheduler.py`
//! and `packages/app/src/voice/resource-scheduler.test.ts` — see the
//! "test parity" section in the campaign notes.

#![allow(clippy::result_large_err)]

mod resource_scheduler;
pub(crate) mod voice_core;

// Public surface re-exported for downstream modules. The pub use is
// consumed by the inline tests (and future callers) so consumers can
// write `use voice::*;` without reaching into the `resource_scheduler`
// sub-module path.
#[allow(unused_imports)]
pub use resource_scheduler::{
    Diagnostics, EvictionEvent, EvictionReason, MemoryPressureState, PlatformSignals,
    ResidencyClass, ResourceId, ResourceLease, ResourcePriority, ThermalStatus,
    VoiceResourceScheduler,
};

#[allow(unused_imports)]
pub use unifia_voice_core::{VoiceError, VoiceErrorCode, VoiceEvent, VoiceEventKind};
