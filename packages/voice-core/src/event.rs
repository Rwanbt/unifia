// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};

use crate::VoiceError;

pub(crate) const MAX_SAFE_VOICE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceProfile {
    Dictation,
    ManualReadAloud,
    Live,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpeechLanguage {
    En,
    Fr,
    Es,
    It,
    De,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocaleSource {
    User,
    SttFinal,
    Conversation,
    Application,
    FallbackEnglish,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolOutcome {
    Ok,
    Denied,
    Errored,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TurnCancelReason {
    UserBarge,
    AgentCancel,
    Error,
    RouteChange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioRoute {
    Speaker,
    WiredHeadset,
    UsbHeadset,
    BluetoothHfp,
    BluetoothA2dp,
    BluetoothLeAudio,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourcePressure {
    Memory,
    Cpu,
    Thermal,
    Network,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StopReason {
    User,
    SessionEnded,
    Error,
    ProcessShutdown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VoiceEventKind {
    VoicePreparing {
        profile: VoiceProfile,
    },
    VoiceReady {
        profile: VoiceProfile,
        capabilities: Vec<String>,
        language: SpeechLanguage,
        voice: String,
        locale_source: LocaleSource,
    },
    SpeechStarted,
    SpeechEnded,
    VadProbability {
        value: f32,
    },
    TurnIncomplete,
    TurnComplete {
        transcript: String,
        confidence: Option<f32>,
    },
    SttPartial {
        text: String,
        stable: bool,
    },
    SttFinal {
        text: String,
        language: SpeechLanguage,
    },
    TurnSubmitted {
        message_id: String,
    },
    AgentThinking,
    AgentWorking {
        tool: Option<String>,
    },
    ToolStarted {
        tool: String,
    },
    ToolFinished {
        tool: String,
        outcome: ToolOutcome,
    },
    PermissionRequired {
        permission: String,
    },
    AssistantTextDelta {
        delta: String,
    },
    AssistantTextFinal {
        text: String,
    },
    SpeechSegmentReady {
        text: String,
        voice: String,
        language: SpeechLanguage,
    },
    TtsStarted {
        segment: u32,
    },
    TtsAudio {
        segment: u32,
        pcm: Vec<i16>,
        sample_rate_hz: u32,
        channels: u8,
    },
    TtsCancelled {
        segment: u32,
        reason: TurnCancelReason,
    },
    AssistantSpeaking,
    AssistantInterrupted,
    AudioRouteChanged {
        route: AudioRoute,
        interrupted: bool,
    },
    ProviderFallback {
        from: String,
        to: String,
        reason: String,
    },
    ResourcePressure {
        pressure: ResourcePressure,
    },
    VoiceRecovering {
        stage: String,
    },
    VoiceError {
        #[serde(flatten)]
        error: VoiceError,
    },
    VoiceStopped {
        reason: StopReason,
    },
}

impl VoiceEventKind {
    pub fn requires_turn_id(&self) -> bool {
        matches!(
            self,
            Self::SpeechStarted
                | Self::SpeechEnded
                | Self::TurnIncomplete
                | Self::TurnComplete { .. }
                | Self::SttPartial { .. }
                | Self::SttFinal { .. }
                | Self::TurnSubmitted { .. }
                | Self::AgentThinking
                | Self::AgentWorking { .. }
                | Self::ToolStarted { .. }
                | Self::ToolFinished { .. }
                | Self::PermissionRequired { .. }
                | Self::AssistantTextDelta { .. }
                | Self::AssistantTextFinal { .. }
                | Self::SpeechSegmentReady { .. }
                | Self::TtsStarted { .. }
                | Self::TtsAudio { .. }
                | Self::TtsCancelled { .. }
                | Self::AssistantSpeaking
                | Self::AssistantInterrupted
        )
    }

    pub fn allows_binding_identity(&self) -> bool {
        matches!(self, Self::VoiceError { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEvent {
    #[serde(rename = "sessionID", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(rename = "bindingID", skip_serializing_if = "Option::is_none")]
    pub binding_id: Option<String>,
    #[serde(rename = "turnID", skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    /// Monotonic milliseconds since the current runtime epoch.
    #[serde(rename = "ts")]
    pub monotonic_timestamp_ms: u64,
    #[serde(rename = "seq")]
    pub sequence: u64,
    pub generation: u64,
    #[serde(flatten)]
    pub event: VoiceEventKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceEventValidationError {
    InvalidIdentity,
    BindingIdentityNotAllowed,
    InvalidTurnIdentity,
    MissingTurnIdentity,
    InvalidTimestamp,
    InvalidConfidence,
    InvalidVadProbability,
    InvalidAudioFormat,
    InvalidError,
    InvalidSequence,
}

impl VoiceEvent {
    pub fn validate(&self) -> Result<(), VoiceEventValidationError> {
        if self.sequence > MAX_SAFE_VOICE_INTEGER {
            return Err(VoiceEventValidationError::InvalidSequence);
        }
        if self.monotonic_timestamp_ms > MAX_SAFE_VOICE_INTEGER {
            return Err(VoiceEventValidationError::InvalidTimestamp);
        }
        let has_session = self.session_id.as_deref().is_some_and(valid_session_id);
        let has_binding = self.binding_id.as_deref().is_some_and(valid_binding_id);
        if has_session == has_binding {
            return Err(VoiceEventValidationError::InvalidIdentity);
        }
        if has_binding && !self.event.allows_binding_identity() {
            return Err(VoiceEventValidationError::BindingIdentityNotAllowed);
        }
        if self.session_id.is_some() && !has_session || self.binding_id.is_some() && !has_binding {
            return Err(VoiceEventValidationError::InvalidIdentity);
        }
        if self
            .turn_id
            .as_deref()
            .is_some_and(|id| id.trim().is_empty() || id.len() > 128)
        {
            return Err(VoiceEventValidationError::InvalidTurnIdentity);
        }
        if self.event.requires_turn_id() && self.turn_id.is_none() {
            return Err(VoiceEventValidationError::MissingTurnIdentity);
        }
        match &self.event {
            VoiceEventKind::VadProbability { value }
                if !value.is_finite() || !(0.0..=1.0).contains(value) =>
            {
                return Err(VoiceEventValidationError::InvalidVadProbability);
            }
            VoiceEventKind::TurnComplete {
                confidence: Some(value),
                ..
            } if !value.is_finite() || !(0.0..=1.0).contains(value) => {
                return Err(VoiceEventValidationError::InvalidConfidence);
            }
            VoiceEventKind::TtsAudio {
                sample_rate_hz,
                channels,
                ..
            } if *sample_rate_hz == 0 || *channels == 0 => {
                return Err(VoiceEventValidationError::InvalidAudioFormat);
            }
            VoiceEventKind::VoiceError { error } if error.validate().is_err() => {
                return Err(VoiceEventValidationError::InvalidError);
            }
            _ => {}
        }
        Ok(())
    }
}

fn valid_session_id(id: &str) -> bool {
    id.starts_with("ses_") && id.len() > 4 && id.len() <= 128
}

fn valid_binding_id(id: &str) -> bool {
    id.starts_with("lvb_")
        && id.len() == 36
        && id[4..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{VoiceErrorCode, VoiceErrorStage};

    fn base(event: VoiceEventKind) -> VoiceEvent {
        VoiceEvent {
            session_id: Some("ses_test".to_owned()),
            binding_id: None,
            turn_id: None,
            monotonic_timestamp_ms: 42,
            sequence: 0,
            generation: 1,
            event,
        }
    }

    #[test]
    fn binding_error_is_correlated_without_session() {
        let mut event = base(VoiceEventKind::VoiceError {
            error: crate::VoiceError::from_code(VoiceErrorCode::ProviderBindingInvalid, None),
        });
        event.session_id = None;
        event.binding_id = Some(format!("lvb_{}", "1".repeat(32)));
        assert_eq!(event.validate(), Ok(()));
        let json = serde_json::to_value(event).unwrap();
        assert_eq!(json["kind"], "voice_error");
        assert!(json.get("sessionID").is_none());
        assert!(json.get("bindingID").is_some());
        assert_eq!(json["cause_category"], "provider");
        assert!(json.get("error").is_none());
    }

    #[test]
    fn rejects_binding_on_non_error_event_and_missing_turn_id() {
        let mut event = base(VoiceEventKind::VoiceReady {
            profile: VoiceProfile::Live,
            capabilities: vec![],
            language: SpeechLanguage::En,
            voice: "en-default".into(),
            locale_source: LocaleSource::FallbackEnglish,
        });
        event.session_id = None;
        event.binding_id = Some(format!("lvb_{}", "2".repeat(32)));
        assert_eq!(
            event.validate(),
            Err(VoiceEventValidationError::BindingIdentityNotAllowed)
        );
        assert_eq!(
            base(VoiceEventKind::SpeechStarted).validate(),
            Err(VoiceEventValidationError::MissingTurnIdentity)
        );
    }

    #[test]
    fn rejects_timestamps_and_sequences_outside_javascript_safe_integer_range() {
        let ready = || VoiceEventKind::VoicePreparing {
            profile: VoiceProfile::Live,
        };
        let mut event = base(ready());
        event.monotonic_timestamp_ms = MAX_SAFE_VOICE_INTEGER + 1;
        assert_eq!(
            event.validate(),
            Err(VoiceEventValidationError::InvalidTimestamp)
        );

        let mut event = base(ready());
        event.sequence = MAX_SAFE_VOICE_INTEGER + 1;
        assert_eq!(
            event.validate(),
            Err(VoiceEventValidationError::InvalidSequence)
        );
    }

    #[test]
    fn error_codes_have_a_stable_stage_and_wire_name() {
        let error = crate::VoiceError::from_code(VoiceErrorCode::VadProviderUnavailable, None);
        assert_eq!(error.stage, VoiceErrorStage::Vad);
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["code"], "VAD_PROVIDER_UNAVAILABLE");
        assert_eq!(json["stage"], "vad");
    }

    #[test]
    fn stt_error_matches_the_cross_runtime_wire_fixture() {
        let event = VoiceEvent {
            session_id: Some("ses_cross_runtime".into()),
            binding_id: None,
            turn_id: Some("turn_cross_runtime".into()),
            monotonic_timestamp_ms: 1234,
            sequence: 7,
            generation: 2,
            event: VoiceEventKind::VoiceError {
                error: crate::VoiceError::from_code(VoiceErrorCode::SttProviderUnavailable, None),
            },
        };
        assert_eq!(event.validate(), Ok(()));

        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/voice-error-stt-unavailable.json"))
                .unwrap();
        assert_eq!(serde_json::to_value(event).unwrap(), fixture);
    }
}
