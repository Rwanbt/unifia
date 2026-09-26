// SPDX-License-Identifier: MIT
//! Tauri boundary for the durable VoiceCore session owner.

use std::path::PathBuf;

use tauri::State;
use unifia_voice_core::{VoiceCoreRuntime, VoiceEvent, VoiceEventKind};

#[derive(Debug)]
pub struct VoiceCoreState(VoiceCoreRuntime);

impl VoiceCoreState {
    pub fn new(root: PathBuf) -> Self {
        Self(VoiceCoreRuntime::new(root))
    }
}

#[tauri::command]
pub fn voice_core_open_session(
    state: State<'_, VoiceCoreState>,
    session_id: String,
) -> Result<u64, String> {
    state
        .0
        .open_session(&session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn voice_core_remaining_turn_capacity(
    state: State<'_, VoiceCoreState>,
    session_id: String,
) -> Result<usize, String> {
    state
        .0
        .remaining_turn_capacity(&session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn voice_core_begin_turn(
    state: State<'_, VoiceCoreState>,
    session_id: String,
    turn_id: String,
) -> Result<(), String> {
    state
        .0
        .begin_turn(&session_id, &turn_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn voice_core_publish(
    state: State<'_, VoiceCoreState>,
    session_id: String,
    turn_id: Option<String>,
    event: VoiceEventKind,
) -> Result<VoiceEvent, String> {
    state
        .0
        .publish(&session_id, turn_id.as_deref(), event)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn voice_core_publish_text_delta(
    state: State<'_, VoiceCoreState>,
    session_id: String,
    turn_id: String,
    delta: String,
) -> Result<VoiceEvent, String> {
    state
        .0
        .publish_assistant_text_delta(&session_id, &turn_id, delta)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn voice_core_close_session(
    state: State<'_, VoiceCoreState>,
    session_id: String,
) -> Result<(), String> {
    state
        .0
        .close_session(&session_id)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_typescript_event_names_and_fields() {
        let submitted: VoiceEventKind = serde_json::from_value(serde_json::json!({
            "kind": "turn_submitted",
            "message_id": "msg_voice_turn"
        }))
        .unwrap();
        assert!(matches!(
            submitted,
            VoiceEventKind::TurnSubmitted { message_id } if message_id == "msg_voice_turn"
        ));

        let thinking: VoiceEventKind =
            serde_json::from_value(serde_json::json!({ "kind": "agent_thinking" })).unwrap();
        assert!(matches!(thinking, VoiceEventKind::AgentThinking));

        let final_text: VoiceEventKind = serde_json::from_value(serde_json::json!({
            "kind": "assistant_text_final",
            "text": "Bonjour."
        }))
        .unwrap();
        assert!(matches!(
            final_text,
            VoiceEventKind::AssistantTextFinal { text } if text == "Bonjour."
        ));
    }
}
