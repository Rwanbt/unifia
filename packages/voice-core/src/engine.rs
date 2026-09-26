// SPDX-License-Identifier: MIT
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::event::MAX_SAFE_VOICE_INTEGER;
use crate::{VoiceEvent, VoiceEventKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceCoreError {
    InvalidSession,
    InvalidTurn,
    StaleSessionGeneration,
    StaleTurnGeneration,
    StalePlaybackGeneration,
    TimestampRegression,
    IdempotencyConflict,
    GenerationExhausted,
    SequenceExhausted,
    InvalidEvent,
}

#[derive(Debug, Clone)]
pub struct TurnToken {
    session_generation: u64,
    turn_id: String,
    turn_generation: u64,
    playback_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCoreSnapshot {
    session_id: String,
    generation: u64,
    monotonic_timestamp_ms: u64,
}

#[derive(Debug)]
pub struct VoiceCore {
    session_id: String,
    generation: u64,
    next_sequence: u64,
    monotonic_timestamp_ms: u64,
    next_turn_generation: u64,
    turns: HashMap<String, TurnState>,
    published_keys: HashMap<String, VoiceEvent>,
}

#[derive(Debug)]
struct TurnState {
    generation: u64,
    playback_generation: u64,
}

impl VoiceCore {
    pub fn new(session_id: impl Into<String>) -> Result<Self, VoiceCoreError> {
        let session_id = session_id.into();
        if !valid_session_id(&session_id) {
            return Err(VoiceCoreError::InvalidSession);
        }
        Ok(Self {
            session_id,
            generation: 1,
            next_sequence: 0,
            monotonic_timestamp_ms: 0,
            next_turn_generation: 1,
            turns: HashMap::new(),
            published_keys: HashMap::new(),
        })
    }

    pub fn snapshot(&self) -> VoiceCoreSnapshot {
        VoiceCoreSnapshot {
            session_id: self.session_id.clone(),
            generation: self.generation,
            monotonic_timestamp_ms: self.monotonic_timestamp_ms,
        }
    }

    pub fn recover(snapshot: VoiceCoreSnapshot) -> Result<Self, VoiceCoreError> {
        if !valid_session_id(&snapshot.session_id) {
            return Err(VoiceCoreError::InvalidSession);
        }
        let generation = snapshot
            .generation
            .checked_add(1)
            .ok_or(VoiceCoreError::GenerationExhausted)?;
        Ok(Self {
            session_id: snapshot.session_id,
            generation,
            next_sequence: 0,
            monotonic_timestamp_ms: snapshot.monotonic_timestamp_ms,
            next_turn_generation: 1,
            turns: HashMap::new(),
            published_keys: HashMap::new(),
        })
    }

    pub fn begin_turn(&mut self, turn_id: impl Into<String>) -> Result<TurnToken, VoiceCoreError> {
        let turn_id = turn_id.into();
        if turn_id.trim().is_empty() || turn_id.len() > 128 {
            return Err(VoiceCoreError::InvalidTurn);
        }
        let turn_generation = self.next_turn_generation;
        self.next_turn_generation = self
            .next_turn_generation
            .checked_add(1)
            .ok_or(VoiceCoreError::GenerationExhausted)?;
        self.turns.insert(
            turn_id.clone(),
            TurnState {
                generation: turn_generation,
                playback_generation: 1,
            },
        );
        Ok(TurnToken {
            session_generation: self.generation,
            turn_id,
            turn_generation,
            playback_generation: 1,
        })
    }

    pub fn cancel_speech(&mut self, token: &TurnToken) -> Result<(), VoiceCoreError> {
        let state = self.turn_state(token)?;
        state.playback_generation = state
            .playback_generation
            .checked_add(1)
            .ok_or(VoiceCoreError::GenerationExhausted)?;
        Ok(())
    }

    pub fn begin_speech(&mut self, token: &TurnToken) -> Result<TurnToken, VoiceCoreError> {
        let state = self.turn_state(token)?;
        Ok(TurnToken {
            session_generation: token.session_generation,
            turn_id: token.turn_id.clone(),
            turn_generation: token.turn_generation,
            playback_generation: state.playback_generation,
        })
    }

    pub fn publish(
        &mut self,
        token: Option<&TurnToken>,
        monotonic_timestamp_ms: u64,
        event: VoiceEventKind,
    ) -> Result<VoiceEvent, VoiceCoreError> {
        if monotonic_timestamp_ms < self.monotonic_timestamp_ms {
            return Err(VoiceCoreError::TimestampRegression);
        }
        let turn_id = match (token, event.requires_turn_id()) {
            (Some(token), _) => {
                self.validate_token(token, event.is_playback_event())?;
                Some(token.turn_id.clone())
            }
            (None, true) => return Err(VoiceCoreError::InvalidTurn),
            (None, false) => None,
        };
        let sequence = self.next_sequence;
        if sequence > MAX_SAFE_VOICE_INTEGER {
            return Err(VoiceCoreError::SequenceExhausted);
        }
        let next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or(VoiceCoreError::SequenceExhausted)?;
        let output = VoiceEvent {
            session_id: Some(self.session_id.clone()),
            binding_id: None,
            turn_id,
            monotonic_timestamp_ms,
            sequence,
            generation: self.generation,
            event,
        };
        output
            .validate()
            .map_err(|_| VoiceCoreError::InvalidEvent)?;
        self.next_sequence = next_sequence;
        self.monotonic_timestamp_ms = monotonic_timestamp_ms;
        Ok(output)
    }

    pub fn publish_once(
        &mut self,
        idempotency_key: impl Into<String>,
        token: Option<&TurnToken>,
        monotonic_timestamp_ms: u64,
        event: VoiceEventKind,
    ) -> Result<VoiceEvent, VoiceCoreError> {
        let idempotency_key = idempotency_key.into();
        if idempotency_key.trim().is_empty() || idempotency_key.len() > 128 {
            return Err(VoiceCoreError::InvalidEvent);
        }
        if let Some(published) = self.published_keys.get(&idempotency_key) {
            if published.turn_id.as_deref() == token.map(|value| value.turn_id.as_str())
                && published.monotonic_timestamp_ms == monotonic_timestamp_ms
                && published.event == event
            {
                return Ok(published.clone());
            }
            return Err(VoiceCoreError::IdempotencyConflict);
        }
        let published = self.publish(token, monotonic_timestamp_ms, event)?;
        self.published_keys
            .insert(idempotency_key, published.clone());
        Ok(published)
    }

    pub fn reconnect(&mut self) -> Result<(), VoiceCoreError> {
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or(VoiceCoreError::GenerationExhausted)?;
        self.next_sequence = 0;
        self.next_turn_generation = 1;
        self.turns.clear();
        self.published_keys.clear();
        Ok(())
    }

    fn turn_state(&mut self, token: &TurnToken) -> Result<&mut TurnState, VoiceCoreError> {
        if token.session_generation != self.generation {
            return Err(VoiceCoreError::StaleSessionGeneration);
        }
        let state = self
            .turns
            .get_mut(&token.turn_id)
            .ok_or(VoiceCoreError::StaleTurnGeneration)?;
        if state.generation != token.turn_generation {
            return Err(VoiceCoreError::StaleTurnGeneration);
        }
        Ok(state)
    }

    fn validate_token(
        &mut self,
        token: &TurnToken,
        playback_event: bool,
    ) -> Result<(), VoiceCoreError> {
        let state = self.turn_state(token)?;
        if playback_event && state.playback_generation != token.playback_generation {
            return Err(VoiceCoreError::StalePlaybackGeneration);
        }
        Ok(())
    }
}

impl VoiceEventKind {
    fn is_playback_event(&self) -> bool {
        matches!(
            self,
            Self::SpeechSegmentReady { .. }
                | Self::TtsStarted { .. }
                | Self::TtsAudio { .. }
                | Self::TtsCancelled { .. }
                | Self::AssistantSpeaking
                | Self::AssistantInterrupted
        )
    }
}

fn valid_session_id(id: &str) -> bool {
    id.starts_with("ses_") && id.len() > 4 && id.len() <= 128
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SpeechLanguage, VoiceProfile};

    #[test]
    fn sequence_is_unique_and_timestamps_cannot_reorder() {
        let mut core = VoiceCore::new("ses_order").unwrap();
        let first = core
            .publish(
                None,
                10,
                VoiceEventKind::VoicePreparing {
                    profile: VoiceProfile::Live,
                },
            )
            .unwrap();
        let second = core
            .publish(
                None,
                11,
                VoiceEventKind::VoiceReady {
                    profile: VoiceProfile::Live,
                    capabilities: vec![],
                    language: SpeechLanguage::En,
                    voice: "en-default".into(),
                    locale_source: crate::LocaleSource::FallbackEnglish,
                },
            )
            .unwrap();
        assert_eq!((first.sequence, second.sequence), (0, 1));
        assert_eq!(second.generation, first.generation);
        assert_eq!(
            core.publish(None, 9, VoiceEventKind::AgentThinking),
            Err(VoiceCoreError::TimestampRegression)
        );
    }

    #[test]
    fn retries_with_the_same_key_return_the_original_event() {
        let mut core = VoiceCore::new("ses_duplicate").unwrap();
        let first = core
            .publish_once(
                "provider-event-1",
                None,
                8,
                VoiceEventKind::VoicePreparing {
                    profile: VoiceProfile::Live,
                },
            )
            .unwrap();
        let repeated = core
            .publish_once(
                "provider-event-1",
                None,
                8,
                VoiceEventKind::VoicePreparing {
                    profile: VoiceProfile::Live,
                },
            )
            .unwrap();
        assert_eq!(first.event, repeated.event);
        assert_eq!((first.sequence, repeated.sequence), (0, 0));
        assert_eq!(
            core.publish_once(
                "provider-event-1",
                None,
                8,
                VoiceEventKind::VoiceStopped {
                    reason: crate::StopReason::User,
                }
            ),
            Err(VoiceCoreError::IdempotencyConflict)
        );
    }

    #[test]
    fn invalid_event_does_not_consume_sequence_or_advance_timestamp() {
        let mut core = VoiceCore::new("ses_invalid_event").unwrap();
        assert_eq!(
            core.publish(None, 50, VoiceEventKind::VadProbability { value: f32::NAN }),
            Err(VoiceCoreError::InvalidEvent)
        );

        let event = core
            .publish(
                None,
                10,
                VoiceEventKind::VoicePreparing {
                    profile: VoiceProfile::Live,
                },
            )
            .unwrap();
        assert_eq!((event.sequence, event.monotonic_timestamp_ms), (0, 10));
    }

    #[test]
    fn sequence_exhaustion_matches_the_javascript_safe_integer_limit() {
        let mut core = VoiceCore::new("ses_sequence_limit").unwrap();
        core.next_sequence = MAX_SAFE_VOICE_INTEGER;
        let last_representable = core
            .publish(
                None,
                1,
                VoiceEventKind::VoicePreparing {
                    profile: VoiceProfile::Live,
                },
            )
            .unwrap();
        assert_eq!(last_representable.sequence, MAX_SAFE_VOICE_INTEGER);
        assert_eq!(
            core.publish(
                None,
                2,
                VoiceEventKind::VoiceReady {
                    profile: VoiceProfile::Live,
                    capabilities: vec![],
                    language: SpeechLanguage::En,
                    voice: "en-default".into(),
                    locale_source: crate::LocaleSource::FallbackEnglish,
                },
            ),
            Err(VoiceCoreError::SequenceExhausted)
        );
    }

    #[test]
    fn reconnect_rejects_old_work_but_starts_a_new_ordered_generation() {
        let mut core = VoiceCore::new("ses_reconnect").unwrap();
        let old = core.begin_turn("turn-old").unwrap();
        core.reconnect().unwrap();
        assert_eq!(
            core.publish(Some(&old), 20, VoiceEventKind::AgentThinking),
            Err(VoiceCoreError::StaleSessionGeneration)
        );
        let event = core
            .publish(
                None,
                21,
                VoiceEventKind::VoiceRecovering {
                    stage: "session".into(),
                },
            )
            .unwrap();
        assert_eq!((event.generation, event.sequence), (2, 0));
    }

    #[test]
    fn barge_in_cancels_only_stale_playback_not_agent_work() {
        let mut core = VoiceCore::new("ses_barge").unwrap();
        let turn = core.begin_turn("turn-1").unwrap();
        core.cancel_speech(&turn).unwrap();
        assert_eq!(
            core.publish(Some(&turn), 10, VoiceEventKind::TtsStarted { segment: 0 }),
            Err(VoiceCoreError::StalePlaybackGeneration)
        );
        let agent_event = core
            .publish(Some(&turn), 11, VoiceEventKind::AgentWorking { tool: None })
            .unwrap();
        assert_eq!(agent_event.turn_id.as_deref(), Some("turn-1"));
        let resumed = core.begin_speech(&turn).unwrap();
        assert!(core
            .publish(
                Some(&resumed),
                12,
                VoiceEventKind::TtsStarted { segment: 1 }
            )
            .is_ok());
    }

    #[test]
    fn process_recovery_fences_old_generation_and_resets_sequence() {
        let mut core = VoiceCore::new("ses_recovery").unwrap();
        let initial = core
            .publish(
                None,
                40,
                VoiceEventKind::VoicePreparing {
                    profile: VoiceProfile::Live,
                },
            )
            .unwrap();
        let mut recovered = VoiceCore::recover(core.snapshot()).unwrap();
        let resumed = recovered
            .publish(
                None,
                41,
                VoiceEventKind::VoiceRecovering {
                    stage: "process".into(),
                },
            )
            .unwrap();
        assert_eq!((initial.sequence, resumed.sequence), (0, 0));
        assert_eq!((initial.generation, resumed.generation), (1, 2));
    }
}
