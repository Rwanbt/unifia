// SPDX-License-Identifier: MIT
//! Stable C ABI for language adapters (Python desktop, Android JNI, etc.).
//!
//! Handles are caller-owned and must be used from one thread at a time.
//! Returned JSON strings are allocated by Rust and must be released with
//! `unifia_voice_core_string_free`. No global state or leaked errors are used.

use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;

use serde::Serialize;

use crate::{TurnToken, VoiceCore, VoiceCoreError, VoiceEvent, VoiceEventKind};

pub struct VoiceCoreHandle {
    core: VoiceCore,
    turns: HashMap<String, TurnToken>,
}

#[derive(Serialize)]
#[serde(tag = "ok", rename_all = "snake_case")]
enum PublishResponse {
    True { event: VoiceEvent },
    False { error: &'static str },
}

fn c_string(value: &str) -> *mut c_char {
    CString::new(value)
        .map(CString::into_raw)
        .unwrap_or(ptr::null_mut())
}

fn error_name(error: VoiceCoreError) -> &'static str {
    match error {
        VoiceCoreError::InvalidSession => "invalid_session",
        VoiceCoreError::InvalidTurn => "invalid_turn",
        VoiceCoreError::StaleSessionGeneration => "stale_session_generation",
        VoiceCoreError::StaleTurnGeneration => "stale_turn_generation",
        VoiceCoreError::StalePlaybackGeneration => "stale_playback_generation",
        VoiceCoreError::TimestampRegression => "timestamp_regression",
        VoiceCoreError::IdempotencyConflict => "idempotency_conflict",
        VoiceCoreError::GenerationExhausted => "generation_exhausted",
        VoiceCoreError::SequenceExhausted => "sequence_exhausted",
        VoiceCoreError::InvalidEvent => "invalid_event",
        VoiceCoreError::InvalidSnapshot => "invalid_snapshot",
        VoiceCoreError::DuplicateTurn => "duplicate_turn",
        VoiceCoreError::TurnHistoryCapacity => "turn_history_capacity",
    }
}

fn publish_response(response: PublishResponse) -> *mut c_char {
    match serde_json::to_string(&response) {
        Ok(json) => c_string(&json),
        Err(_) => c_string(r#"{"ok":"false","error":"serialization_failed"}"#),
    }
}

fn input_string(value: *const c_char) -> Result<String, &'static str> {
    if value.is_null() {
        return Err("null_input");
    }
    // SAFETY: the C ABI contract requires a valid NUL-terminated string for
    // the duration of this call. The returned view does not outlive the call.
    unsafe { CStr::from_ptr(value) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "invalid_utf8")
}

/// Construct a VoiceCore handle. Returns null for an invalid session ID.
///
/// # Safety
/// `session_id` must point to a readable NUL-terminated UTF-8 string for this call.
#[no_mangle]
pub unsafe extern "C" fn unifia_voice_core_create(
    session_id: *const c_char,
) -> *mut VoiceCoreHandle {
    catch_unwind(AssertUnwindSafe(|| {
        let Ok(session_id) = input_string(session_id) else {
            return ptr::null_mut();
        };
        let Ok(core) = VoiceCore::new(session_id) else {
            return ptr::null_mut();
        };
        Box::into_raw(Box::new(VoiceCoreHandle {
            core,
            turns: HashMap::new(),
        }))
    }))
    .unwrap_or(ptr::null_mut())
}

/// Begin and durably fence a turn ID in the canonical core. Returns zero on
/// success and a stable negative error code otherwise.
///
/// # Safety
/// `handle` must be a live handle returned by `unifia_voice_core_create`, and
/// `turn_id` must point to a readable NUL-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn unifia_voice_core_begin_turn(
    handle: *mut VoiceCoreHandle,
    turn_id: *const c_char,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: the caller must pass a live handle returned by create.
        let Some(handle) = (unsafe { handle.as_mut() }) else {
            return -1;
        };
        let Ok(turn_id) = input_string(turn_id) else {
            return -2;
        };
        match handle.core.begin_turn(turn_id.as_str()) {
            Ok(token) => {
                handle.turns.insert(turn_id, token);
                0
            }
            Err(error) => -error_code(error),
        }
    }))
    .unwrap_or(-127)
}

/// Publish one canonical VoiceEventKind JSON object. `turn_id` may be null
/// only for event kinds that do not require a turn. Returns a Rust-owned JSON
/// string shaped as `{ "ok": "true", "event": ... }` or `{ "ok": "false",
/// "error": "..." }`.
///
/// # Safety
/// `handle` must be live. A non-null `turn_id` and `event_json` must each point
/// to readable NUL-terminated UTF-8 strings for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn unifia_voice_core_publish(
    handle: *mut VoiceCoreHandle,
    turn_id: *const c_char,
    timestamp_ms: u64,
    event_json: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: the caller must pass a live handle returned by create.
        let Some(handle) = (unsafe { handle.as_mut() }) else {
            return publish_response(PublishResponse::False {
                error: "invalid_handle",
            });
        };
        let turn = if turn_id.is_null() {
            None
        } else {
            match input_string(turn_id) {
                Ok(turn_id) => match handle.turns.get(&turn_id) {
                    Some(token) => Some(token),
                    None => {
                        return publish_response(PublishResponse::False {
                            error: "invalid_turn",
                        })
                    }
                },
                Err(error) => return publish_response(PublishResponse::False { error }),
            }
        };
        let event_json = match input_string(event_json) {
            Ok(json) => json,
            Err(error) => return publish_response(PublishResponse::False { error }),
        };
        let event: VoiceEventKind = match serde_json::from_str(&event_json) {
            Ok(event) => event,
            Err(_) => {
                return publish_response(PublishResponse::False {
                    error: "invalid_event_json",
                })
            }
        };
        match handle.core.publish(turn, timestamp_ms, event) {
            Ok(event) => publish_response(PublishResponse::True { event }),
            Err(error) => publish_response(PublishResponse::False {
                error: error_name(error),
            }),
        }
    }))
    .unwrap_or_else(|_| {
        publish_response(PublishResponse::False {
            error: "panic_contained",
        })
    })
}

/// Start a new generation after a reconnect/process recovery boundary.
///
/// # Safety
/// `handle` must be a live handle returned by `unifia_voice_core_create`.
#[no_mangle]
pub unsafe extern "C" fn unifia_voice_core_reconnect(handle: *mut VoiceCoreHandle) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: the caller must pass a live handle returned by create.
        let Some(handle) = (unsafe { handle.as_mut() }) else {
            return -1;
        };
        match handle.core.reconnect() {
            Ok(()) => {
                handle.turns.clear();
                0
            }
            Err(error) => -error_code(error),
        }
    }))
    .unwrap_or(-127)
}

/// Destroy a handle. The caller must not use it again.
///
/// # Safety
/// `handle` must be a live pointer returned by `unifia_voice_core_create` and
/// must not have been destroyed already.
#[no_mangle]
pub unsafe extern "C" fn unifia_voice_core_destroy(handle: *mut VoiceCoreHandle) {
    if handle.is_null() {
        return;
    }
    // SAFETY: this consumes exactly one pointer returned by Box::into_raw.
    let _ = catch_unwind(AssertUnwindSafe(|| unsafe { drop(Box::from_raw(handle)) }));
}

/// Release a JSON string returned by `unifia_voice_core_publish`.
///
/// # Safety
/// `value` must be a non-null, unfreed pointer returned by this library.
#[no_mangle]
pub unsafe extern "C" fn unifia_voice_core_string_free(value: *mut c_char) {
    if value.is_null() {
        return;
    }
    // SAFETY: the pointer must be an unfreed string returned by `c_string`.
    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
        drop(CString::from_raw(value))
    }));
}

fn error_code(error: VoiceCoreError) -> i32 {
    match error {
        VoiceCoreError::InvalidSession => 1,
        VoiceCoreError::InvalidTurn => 2,
        VoiceCoreError::StaleSessionGeneration => 3,
        VoiceCoreError::StaleTurnGeneration => 4,
        VoiceCoreError::StalePlaybackGeneration => 5,
        VoiceCoreError::TimestampRegression => 6,
        VoiceCoreError::IdempotencyConflict => 7,
        VoiceCoreError::GenerationExhausted => 8,
        VoiceCoreError::SequenceExhausted => 9,
        VoiceCoreError::InvalidEvent => 10,
        VoiceCoreError::InvalidSnapshot => 11,
        VoiceCoreError::DuplicateTurn => 12,
        VoiceCoreError::TurnHistoryCapacity => 13,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn ffi_handle_publishes_the_canonical_sequence_and_generation() {
        let session = CString::new("ses_ffi_fixture").unwrap();
        let turn = CString::new("turn-1").unwrap();
        let kind = CString::new(r#"{"kind":"turn_submitted","message_id":"msg-1"}"#).unwrap();
        // SAFETY: pointers are valid NUL-terminated strings for each call.
        let handle = unsafe { unifia_voice_core_create(session.as_ptr()) };
        assert!(!handle.is_null());
        assert_eq!(
            unsafe { unifia_voice_core_begin_turn(handle, turn.as_ptr()) },
            0
        );
        let output = unsafe { unifia_voice_core_publish(handle, turn.as_ptr(), 7, kind.as_ptr()) };
        assert!(!output.is_null());
        let value: serde_json::Value = unsafe { CStr::from_ptr(output) }
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(value["ok"], "true");
        assert_eq!(value["event"]["sessionID"], "ses_ffi_fixture");
        assert_eq!(value["event"]["turnID"], "turn-1");
        assert_eq!(value["event"]["seq"], 0);
        assert_eq!(value["event"]["generation"], 1);
        unsafe {
            unifia_voice_core_string_free(output);
            unifia_voice_core_destroy(handle);
        }
    }

    #[test]
    fn ffi_rejects_duplicate_turns_and_contains_invalid_events() {
        let session = CString::new("ses_ffi_fixture").unwrap();
        let turn = CString::new("turn-1").unwrap();
        let invalid = CString::new(r#"{"kind":"not_a_voice_event"}"#).unwrap();
        // SAFETY: pointers are valid NUL-terminated strings for each call.
        let handle = unsafe { unifia_voice_core_create(session.as_ptr()) };
        assert_eq!(
            unsafe { unifia_voice_core_begin_turn(handle, turn.as_ptr()) },
            0
        );
        assert_eq!(
            unsafe { unifia_voice_core_begin_turn(handle, turn.as_ptr()) },
            -12
        );
        let output =
            unsafe { unifia_voice_core_publish(handle, turn.as_ptr(), 1, invalid.as_ptr()) };
        let value: serde_json::Value = unsafe { CStr::from_ptr(output) }
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(value["ok"], "false");
        assert_eq!(value["error"], "invalid_event_json");
        unsafe {
            unifia_voice_core_string_free(output);
            unifia_voice_core_destroy(handle);
        }
    }
}
