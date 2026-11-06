// SPDX-License-Identifier: MIT

//! Error returned by every voice command. The webview decides what to show
//! from `code`, a stable token it maps to a translation key. `message` is for
//! logs only: nothing on the webview side compares its text.

use serde::Serialize;
use std::fmt;
use unifia_speech_api::SpeechError;

pub(crate) const AUDIO_BUSY: &str = "audio_busy";
pub(crate) const LIVE_ACTIVE: &str = "live_active";
pub(crate) const MODEL_MISSING: &str = "model_missing";
pub(crate) const MODEL_DOWNLOAD_FAILED: &str = "model_download_failed";
pub(crate) const MODEL_LOAD_FAILED: &str = "model_load_failed";
pub(crate) const ABI_UNSUPPORTED: &str = "abi_unsupported";
pub(crate) const SESSION_NOT_OPEN: &str = "session_not_open";
pub(crate) const NO_DICTATION: &str = "no_dictation";
pub(crate) const UTTERANCE_EXPIRED: &str = "utterance_expired";
pub(crate) const SESSION_FAILED: &str = "session_failed";
pub(crate) const INVALID_INPUT: &str = "invalid_input";

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct VoiceError {
    code: &'static str,
    message: String,
}

impl VoiceError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        let message = message.into();
        log::warn!("[voice] {code}: {message}");
        Self { code, message }
    }

    pub(crate) fn session(message: impl Into<String>) -> Self {
        Self::new(SESSION_FAILED, message)
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new(INVALID_INPUT, message)
    }

    #[cfg(test)]
    pub(crate) fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for VoiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl From<SpeechError> for VoiceError {
    fn from(error: SpeechError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<String> for VoiceError {
    fn from(message: String) -> Self {
        Self::session(message)
    }
}

impl From<&str> for VoiceError {
    fn from(message: &str) -> Self {
        Self::session(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_errors_keep_their_stable_code() {
        for error in [
            SpeechError::ModelMissing,
            SpeechError::ModelCorrupt,
            SpeechError::AudioBusy,
            SpeechError::UnsupportedLanguage,
            SpeechError::UnsupportedFormat,
            SpeechError::NotAvailable,
            SpeechError::Inference,
            SpeechError::Cancelled,
        ] {
            let converted = VoiceError::from(error);
            assert_eq!(converted.code(), error.code());
            assert_eq!(converted.message, error.to_string());
        }
    }

    #[test]
    fn session_codes_survive_serialization_without_parsing_messages() {
        for code in [
            AUDIO_BUSY,
            LIVE_ACTIVE,
            MODEL_MISSING,
            MODEL_DOWNLOAD_FAILED,
            MODEL_LOAD_FAILED,
            ABI_UNSUPPORTED,
            SESSION_NOT_OPEN,
            NO_DICTATION,
            UTTERANCE_EXPIRED,
            SESSION_FAILED,
            INVALID_INPUT,
        ] {
            let error = VoiceError::new(code, "arbitrary diagnostic");
            let json = serde_json::to_value(&error).expect("serializable");
            assert_eq!(json["code"], code);
            assert_eq!(json["message"], "arbitrary diagnostic");
        }
        assert_eq!(VoiceError::invalid("bad input").code(), INVALID_INPUT);
    }

    #[test]
    fn the_serialized_shape_is_code_and_message() {
        let error = VoiceError::new(LIVE_ACTIVE, "Live est actif");
        let json = serde_json::to_string(&error).expect("serializable");
        assert_eq!(json, r#"{"code":"live_active","message":"Live est actif"}"#);
    }
}
