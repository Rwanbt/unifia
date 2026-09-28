// SPDX-License-Identifier: MIT
//! Durable owner for active VoiceCore sessions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use sha2::{Digest, Sha256};

use crate::{
    TurnToken, VoiceCore, VoiceCoreError, VoiceCoreSnapshotStore, VoiceCoreSnapshotStoreError,
    VoiceEvent, VoiceEventKind,
};

const MAX_SAFE_VOICE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug)]
pub enum VoiceCoreRuntimeError {
    Core(VoiceCoreError),
    Store(VoiceCoreSnapshotStoreError),
    MissingTurn,
    LockPoisoned,
    TimestampExhausted,
}

impl std::fmt::Display for VoiceCoreRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Core(error) => write!(formatter, "VoiceCore rejected the operation: {error:?}"),
            Self::Store(error) => write!(formatter, "VoiceCore snapshot failed: {error}"),
            Self::MissingTurn => formatter.write_str("VoiceCore turn is not active"),
            Self::LockPoisoned => formatter.write_str("VoiceCore runtime lock is poisoned"),
            Self::TimestampExhausted => formatter.write_str("VoiceCore timestamp is exhausted"),
        }
    }
}

impl std::error::Error for VoiceCoreRuntimeError {}

#[derive(Debug)]
pub struct VoiceCoreRuntime {
    root: PathBuf,
    sessions: Mutex<HashMap<String, ActiveSession>>,
}

#[derive(Debug)]
struct ActiveSession {
    core: VoiceCore,
    store: VoiceCoreSnapshotStore,
    turns: HashMap<String, TurnToken>,
    timestamp_base_ms: u64,
    clock_origin: Instant,
}

impl VoiceCoreRuntime {
    /// Creates a runtime whose root is owned by the host application's data directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Opens or recovers a session and durably advances its process generation.
    pub fn open_session(&self, session_id: &str) -> Result<u64, VoiceCoreRuntimeError> {
        let mut sessions = self.lock_sessions()?;
        let active = self.active_session(&mut sessions, session_id)?;
        Ok(active.core.snapshot().generation())
    }

    /// Reports remaining replay-protected turns without weakening the persisted history.
    pub fn remaining_turn_capacity(
        &self,
        session_id: &str,
    ) -> Result<usize, VoiceCoreRuntimeError> {
        let mut sessions = self.lock_sessions()?;
        let active = self.active_session(&mut sessions, session_id)?;
        Ok(active.core.remaining_turn_capacity())
    }

    /// Reserves a unique turn ID and persists replay protection before returning.
    pub fn begin_turn(&self, session_id: &str, turn_id: &str) -> Result<(), VoiceCoreRuntimeError> {
        let mut sessions = self.lock_sessions()?;
        let active = self.active_session(&mut sessions, session_id)?;
        let previous = active.core.clone();
        let token = active
            .core
            .begin_turn(turn_id)
            .map_err(VoiceCoreRuntimeError::Core)?;
        if let Err(error) = active.store.persist(&active.core.snapshot()) {
            active.core = previous;
            return Err(VoiceCoreRuntimeError::Store(error));
        }
        active.turns.insert(turn_id.to_owned(), token);
        Ok(())
    }

    /// Publishes one ordered event and persists its sequence before it reaches the caller.
    pub fn publish(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        event: VoiceEventKind,
    ) -> Result<VoiceEvent, VoiceCoreRuntimeError> {
        self.publish_event(session_id, turn_id, event, true)
    }

    // See ADR-075: snapshots are not an event log, so each token must not trigger a disk flush.
    pub fn publish_assistant_text_delta(
        &self,
        session_id: &str,
        turn_id: &str,
        delta: String,
    ) -> Result<VoiceEvent, VoiceCoreRuntimeError> {
        self.publish_event(
            session_id,
            Some(turn_id),
            VoiceEventKind::AssistantTextDelta { delta },
            false,
        )
    }

    fn publish_event(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        event: VoiceEventKind,
        persist: bool,
    ) -> Result<VoiceEvent, VoiceCoreRuntimeError> {
        let mut sessions = self.lock_sessions()?;
        let active = self.active_session(&mut sessions, session_id)?;
        let token = turn_id
            .map(|id| {
                active
                    .turns
                    .get(id)
                    .ok_or(VoiceCoreRuntimeError::MissingTurn)
            })
            .transpose()?;
        let timestamp = Self::timestamp(active)?;
        let previous = active.core.clone();
        let published = active
            .core
            .publish(token, timestamp, event)
            .map_err(VoiceCoreRuntimeError::Core)?;
        if persist {
            if let Err(error) = active.store.persist(&active.core.snapshot()) {
                active.core = previous;
                return Err(VoiceCoreRuntimeError::Store(error));
            }
        }
        Ok(published)
    }

    /// Ends an in-memory session while preserving its last durable snapshot.
    pub fn close_session(&self, session_id: &str) -> Result<(), VoiceCoreRuntimeError> {
        let mut sessions = self.lock_sessions()?;
        if let Some(active) = sessions.get(session_id) {
            active
                .store
                .persist(&active.core.snapshot())
                .map_err(VoiceCoreRuntimeError::Store)?;
        }
        sessions.remove(session_id);
        Ok(())
    }

    fn lock_sessions(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, ActiveSession>>, VoiceCoreRuntimeError>
    {
        self.sessions
            .lock()
            .map_err(|_| VoiceCoreRuntimeError::LockPoisoned)
    }

    fn active_session<'a>(
        &self,
        sessions: &'a mut HashMap<String, ActiveSession>,
        session_id: &str,
    ) -> Result<&'a mut ActiveSession, VoiceCoreRuntimeError> {
        if !sessions.contains_key(session_id) {
            let fresh = VoiceCore::new(session_id).map_err(VoiceCoreRuntimeError::Core)?;
            let store = VoiceCoreSnapshotStore::new(self.session_root(session_id));
            let core = match store.load().map_err(VoiceCoreRuntimeError::Store)? {
                Some(snapshot) => {
                    VoiceCore::recover(snapshot).map_err(VoiceCoreRuntimeError::Core)?
                }
                None => fresh,
            };
            let timestamp_base_ms = core
                .snapshot()
                .monotonic_timestamp_ms()
                .checked_add(1)
                .ok_or(VoiceCoreRuntimeError::TimestampExhausted)?;
            store
                .persist(&core.snapshot())
                .map_err(VoiceCoreRuntimeError::Store)?;
            sessions.insert(
                session_id.to_owned(),
                ActiveSession {
                    core,
                    store,
                    turns: HashMap::new(),
                    timestamp_base_ms,
                    clock_origin: Instant::now(),
                },
            );
        }
        sessions
            .get_mut(session_id)
            .ok_or(VoiceCoreRuntimeError::LockPoisoned)
    }

    fn session_root(&self, session_id: &str) -> PathBuf {
        let digest = Sha256::digest(session_id.as_bytes());
        self.root.join(hex::encode(digest))
    }

    fn timestamp(active: &ActiveSession) -> Result<u64, VoiceCoreRuntimeError> {
        let elapsed = u64::try_from(active.clock_origin.elapsed().as_millis())
            .map_err(|_| VoiceCoreRuntimeError::TimestampExhausted)?;
        let timestamp = active
            .timestamp_base_ms
            .checked_add(elapsed)
            .filter(|value| *value <= MAX_SAFE_VOICE_INTEGER)
            .ok_or(VoiceCoreRuntimeError::TimestampExhausted)?;
        Ok(timestamp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{VoiceCoreError, VoiceProfile};

    fn test_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "voice-runtime-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn persists_turn_reservation_before_returning_and_rejects_replay_after_restart() {
        let root = test_root("replay");
        {
            let runtime = VoiceCoreRuntime::new(&root);
            runtime.begin_turn("ses_runtime_replay", "msg_one").unwrap();
            let event = runtime
                .publish(
                    "ses_runtime_replay",
                    None,
                    VoiceEventKind::VoicePreparing {
                        profile: VoiceProfile::Live,
                    },
                )
                .unwrap();
            assert_eq!((event.generation, event.sequence), (1, 0));
        }
        let recovered = VoiceCoreRuntime::new(&root);
        assert_eq!(recovered.open_session("ses_runtime_replay").unwrap(), 2);
        assert!(matches!(
            recovered.begin_turn("ses_runtime_replay", "msg_one"),
            Err(VoiceCoreRuntimeError::Core(VoiceCoreError::DuplicateTurn))
        ));
        recovered
            .begin_turn("ses_runtime_replay", "msg_two")
            .unwrap();
        let next = recovered
            .publish(
                "ses_runtime_replay",
                Some("msg_two"),
                VoiceEventKind::AgentThinking,
            )
            .unwrap();
        assert_eq!((next.generation, next.sequence), (2, 0));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn remaining_turn_capacity_recovers_the_durable_history_count() {
        let root = test_root("capacity");
        {
            let runtime = VoiceCoreRuntime::new(&root);
            assert_eq!(
                runtime
                    .remaining_turn_capacity("ses_runtime_capacity")
                    .unwrap(),
                4096
            );
            runtime
                .begin_turn("ses_runtime_capacity", "msg_capacity_one")
                .unwrap();
            assert_eq!(
                runtime
                    .remaining_turn_capacity("ses_runtime_capacity")
                    .unwrap(),
                4095
            );
        }
        let recovered = VoiceCoreRuntime::new(&root);
        assert_eq!(
            recovered
                .remaining_turn_capacity("ses_runtime_capacity")
                .unwrap(),
            4095
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_turn_scoped_events_without_an_active_token() {
        let root = test_root("missing-turn");
        let runtime = VoiceCoreRuntime::new(&root);
        assert!(matches!(
            runtime.publish(
                "ses_runtime_missing",
                Some("msg_missing"),
                VoiceEventKind::AgentThinking,
            ),
            Err(VoiceCoreRuntimeError::MissingTurn)
        ));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn token_deltas_advance_sequence_without_forcing_snapshot_writes() {
        let root = test_root("stream-delta");
        let runtime = VoiceCoreRuntime::new(&root);
        runtime.begin_turn("ses_stream_delta", "msg_voice").unwrap();

        let first = runtime
            .publish_assistant_text_delta("ses_stream_delta", "msg_voice", "Hel".into())
            .unwrap();
        let second = runtime
            .publish_assistant_text_delta("ses_stream_delta", "msg_voice", "lo".into())
            .unwrap();
        let final_event = runtime
            .publish(
                "ses_stream_delta",
                Some("msg_voice"),
                VoiceEventKind::AssistantTextFinal {
                    text: "Hello".into(),
                },
            )
            .unwrap();

        assert_eq!(
            (first.sequence, second.sequence, final_event.sequence),
            (0, 1, 2)
        );
        assert_eq!(first.generation, final_event.generation);
        let _ = std::fs::remove_dir_all(root);
    }
}
