// SPDX-License-Identifier: MIT
//! Canonical, platform-independent Voice contracts.
//!
//! This crate is the Rust source of truth for serialized Voice events and
//! errors. Platform runtimes adapt their providers to this contract; they do
//! not own a second event vocabulary.

mod engine;
mod error;
mod event;

pub use engine::{TurnToken, VoiceCore, VoiceCoreError, VoiceCoreSnapshot};
pub use error::{
    VoiceError, VoiceErrorCause, VoiceErrorCode, VoiceErrorStage, VoiceErrorValidationError,
};
pub use event::{
    AudioRoute, LocaleSource, ResourcePressure, SpeechLanguage, StopReason, ToolOutcome,
    TurnCancelReason, VoiceEvent, VoiceEventKind, VoiceEventValidationError, VoiceProfile,
};
