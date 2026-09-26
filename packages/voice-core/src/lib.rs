// SPDX-License-Identifier: MIT
//! Canonical, platform-independent Voice contracts.
//!
//! This crate is the Rust source of truth for serialized Voice events and
//! errors. Platform runtimes adapt their providers to this contract; they do
//! not own a second event vocabulary.

mod engine;
mod error;
mod event;
mod runtime;
mod snapshot_store;

pub use engine::{TurnToken, VoiceCore, VoiceCoreError, VoiceCoreSnapshot, MAX_ISSUED_TURN_IDS};
pub use error::{
    VoiceError, VoiceErrorCause, VoiceErrorCode, VoiceErrorStage, VoiceErrorValidationError,
};
pub use event::{
    AudioRoute, LocaleSource, ResourcePressure, SpeechLanguage, StopReason, ToolOutcome,
    TurnCancelReason, VoiceEvent, VoiceEventKind, VoiceEventValidationError, VoiceProfile,
};
pub use runtime::{VoiceCoreRuntime, VoiceCoreRuntimeError};
pub use snapshot_store::{VoiceCoreSnapshotStore, VoiceCoreSnapshotStoreError};
