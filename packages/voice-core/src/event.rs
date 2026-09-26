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

    fn ordering_violations(fixture: &serde_json::Value) -> Vec<String> {
        let mut violations = Vec::new();
        let precedence: Vec<(String, String)> = fixture["precedence"]
            .as_array()
            .expect("precedence array")
            .iter()
            .map(|rule| {
                (
                    rule["before"].as_str().expect("before").to_owned(),
                    rule["after"].as_str().expect("after").to_owned(),
                )
            })
            .collect();

        for trace in fixture["traces"].as_array().expect("traces array") {
            let name = trace["name"].as_str().expect("trace name");
            let events = trace["events"].as_array().expect("events array");
            let mut previous_sequence: Option<u64> = None;
            let mut previous_timestamp: Option<u64> = None;
            let mut generation: Option<u64> = None;
            let mut session: Option<String> = None;
            let mut first_seen: Vec<(String, usize)> = Vec::new();

            for (index, value) in events.iter().enumerate() {
                let event = match serde_json::from_value::<VoiceEvent>(value.clone()) {
                    Ok(event) => event,
                    Err(error) => {
                        violations.push(format!("{name}[{index}] deserialize: {error}"));
                        continue;
                    }
                };
                if let Err(error) = event.validate() {
                    violations.push(format!("{name}[{index}] validate: {error:?}"));
                }
                if let Some(previous) = previous_sequence {
                    if event.sequence <= previous {
                        violations.push(format!(
                            "{name}[{index}] sequence {} does not increase past {previous}",
                            event.sequence
                        ));
                    }
                }
                if let Some(previous) = previous_timestamp {
                    if event.monotonic_timestamp_ms < previous {
                        violations.push(format!(
                            "{name}[{index}] timestamp {} regresses past {previous}",
                            event.monotonic_timestamp_ms
                        ));
                    }
                }
                match generation {
                    None => generation = Some(event.generation),
                    Some(expected) if expected == event.generation => {}
                    Some(expected) => violations.push(format!(
                        "{name}[{index}] generation {} differs from {expected}",
                        event.generation
                    )),
                }
                match &session {
                    None => session = event.session_id.clone(),
                    Some(expected) if event.session_id.as_ref() == Some(expected) => {}
                    Some(expected) => violations.push(format!(
                        "{name}[{index}] session {:?} differs from {expected:?}",
                        event.session_id
                    )),
                }
                previous_sequence = Some(event.sequence);
                previous_timestamp = Some(event.monotonic_timestamp_ms);

                let kind = value["kind"].as_str().expect("kind").to_owned();
                if !first_seen.iter().any(|(seen, _)| seen == &kind) {
                    first_seen.push((kind, index));
                }
            }

            for (before, after) in &precedence {
                let before_index = first_seen.iter().find(|(kind, _)| kind == before);
                let after_index = first_seen.iter().find(|(kind, _)| kind == after);
                if let (Some((_, before)), Some((_, after))) = (before_index, after_index) {
                    if before >= after {
                        violations.push(format!(
                            "{name}: {before} (index {before}) must precede {after} (index {after})"
                        ));
                    }
                }
            }
        }
        violations
    }

    #[test]
    fn event_ordering_fixture_envelopes_validate_and_follow_precedence() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/event-ordering.json")).unwrap();
        let violations = ordering_violations(&fixture);
        assert!(violations.is_empty(), "violations: {violations:#?}");
    }

    #[test]
    fn event_ordering_fixture_detects_reordering_and_sequence_regressions() {
        let mut fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/event-ordering.json")).unwrap();

        let events = &mut fixture["traces"][0]["events"];
        events.as_array_mut().unwrap().swap(0, 1);
        assert!(!ordering_violations(&fixture).is_empty());

        let mut fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/event-ordering.json")).unwrap();
        fixture["traces"][0]["events"][2]["seq"] = serde_json::json!(0);
        assert!(!ordering_violations(&fixture).is_empty());
    }

    #[test]
    fn adr_060_projection_matches_voice_event_kinds() {
        let adr_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/adr/ADR-060-voice-turn-engine-design.md");
        let text = std::fs::read_to_string(&adr_path)
            .expect("ADR-060 must be readable from packages/voice-core");
        let start = text
            .find("export type VoiceEvent =")
            .expect("ADR-060 must project export type VoiceEvent");
        let rest = &text[start..];
        let end = rest
            .find("```")
            .expect("VoiceEvent union stays inside a fence");
        let block = &rest[..end];

        let mut kinds: Vec<&str> = Vec::new();
        let mut cursor = block;
        while let Some(found) = cursor.find("kind: \"") {
            let after = &cursor[found + "kind: \"".len()..];
            let quote = after.find('"').expect("closed kind string literal");
            kinds.push(&after[..quote]);
            cursor = &after[quote + 1..];
        }

        let expected = [
            "voice_preparing",
            "voice_ready",
            "speech_started",
            "speech_ended",
            "vad_probability",
            "turn_incomplete",
            "turn_complete",
            "stt_partial",
            "stt_final",
            "turn_submitted",
            "agent_thinking",
            "agent_working",
            "tool_started",
            "tool_finished",
            "permission_required",
            "assistant_text_delta",
            "assistant_text_final",
            "speech_segment_ready",
            "tts_started",
            "tts_audio",
            "tts_cancelled",
            "assistant_speaking",
            "assistant_interrupted",
            "audio_route_changed",
            "provider_fallback",
            "resource_pressure",
            "voice_recovering",
            "voice_error",
            "voice_stopped",
        ];
        assert_eq!(
            kinds, expected,
            "ADR-060 VoiceEvent union must list every VoiceEventKind in declaration order"
        );
        assert_eq!(
            block.matches("generation: number").count(),
            expected.len(),
            "every projected event carries the generation envelope field"
        );
    }
}
