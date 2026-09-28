// SPDX-License-Identifier: MIT

use serde::Deserialize;
use tauri::Manager;

const MAX_TTS_AUDIO_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) struct NativeResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SynthesisInput {
    text: String,
    language: String,
    voice: Option<String>,
    #[serde(rename = "requestId")]
    request_id: String,
}

pub(crate) struct ManualTtsState {
    active_request: tokio::sync::Mutex<Option<String>>,
    permit: std::sync::Arc<tokio::sync::Semaphore>,
}

impl Default for ManualTtsState {
    fn default() -> Self {
        Self {
            active_request: tokio::sync::Mutex::new(None),
            permit: std::sync::Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
}

pub(crate) async fn handle(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    body: &[u8],
) -> NativeResponse {
    match (method, path) {
        ("POST", "/tts/synthesize") => synthesize(app, body).await,
        ("POST", "/tts/cancel") => cancel(app, body).await,
        _ => error_response(405, "unsupported native speech request"),
    }
}

async fn synthesize(app: &tauri::AppHandle, body: &[u8]) -> NativeResponse {
    let input: SynthesisInput = match serde_json::from_slice(body) {
        Ok(input) => input,
        Err(_) => return error_response(400, "invalid speech request"),
    };
    if !matches!(input.language.as_str(), "en" | "fr" | "es" | "it" | "de") {
        return error_response(400, "unsupported speech language");
    }
    if input.text.len() > 24 * 1024 {
        return error_response(413, "speech text exceeds the mobile limit");
    }
    if input.request_id.len() > 64 || input.request_id.is_empty() {
        return error_response(400, "invalid speech request ID");
    }
    let state = app.state::<ManualTtsState>();
    let Ok(_permit) = state.permit.clone().try_acquire_owned() else {
        return error_response(409, "manual speech is already active");
    };
    *state.active_request.lock().await = Some(input.request_id.clone());

    let result = crate::speech::synthesize_with_provider_to_file(
        app,
        &input.text,
        input.voice,
        Some(input.language),
        None,
    )
    .await;
    let active = state.active_request.lock().await;
    let still_active = active.as_deref() == Some(input.request_id.as_str());
    drop(active);
    *state.active_request.lock().await = None;
    if !still_active {
        if let Ok((path, _)) = result {
            let _ = tokio::fs::remove_file(path).await;
        }
        return error_response(409, "speech request was cancelled");
    }
    let (path, _) = match result {
        Ok(result) => result,
        Err(error) => return error_response(500, &error),
    };

    let result = async {
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|error| format!("inspect synthesized audio: {error}"))?;
        if metadata.len() > MAX_TTS_AUDIO_BYTES {
            return Err("synthesized audio exceeds the response limit".to_string());
        }
        tokio::fs::read(&path)
            .await
            .map_err(|error| format!("read synthesized audio: {error}"))
    }
    .await;
    if let Err(error) = tokio::fs::remove_file(&path).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%error, "Could not remove mobile TTS artifact");
    }
    match result {
        Ok(audio) => NativeResponse {
            status: 200,
            content_type: "audio/wav",
            body: audio,
        },
        Err(error) => error_response(500, &error),
    }
}

async fn cancel(app: &tauri::AppHandle, body: &[u8]) -> NativeResponse {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct CancelInput {
        #[serde(rename = "requestId")]
        request_id: String,
    }
    let input: CancelInput = match serde_json::from_slice(body) {
        Ok(input) => input,
        Err(_) => return error_response(400, "invalid cancellation request"),
    };
    let state = app.state::<ManualTtsState>();
    let mut active = state.active_request.lock().await;
    if active.as_deref() != Some(input.request_id.as_str()) {
        return error_response(404, "speech request is no longer active");
    }
    *active = None;
    match crate::speech::tts_cancel(app.clone()).await {
        Ok(()) => empty(204),
        Err(error) => error_response(500, &error),
    }
}

fn empty(status: u16) -> NativeResponse {
    NativeResponse {
        status,
        content_type: "application/json",
        body: Vec::new(),
    }
}

fn error_response(status: u16, message: &str) -> NativeResponse {
    NativeResponse {
        status,
        content_type: "application/json",
        body: serde_json::json!({ "error": message })
            .to_string()
            .into_bytes(),
    }
}

#[cfg(test)]
mod tests {
    use super::{SynthesisInput, error_response};

    #[test]
    fn synthesis_input_rejects_unrecognized_fields() {
        let result = serde_json::from_str::<SynthesisInput>(
            r#"{"text":"hello","language":"en","requestId":"tts_1","path":"C:\\secret"}"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn errors_are_json_without_audio_content_type() {
        let response = error_response(400, "invalid speech request");
        assert_eq!(response.status, 400);
        assert_eq!(response.content_type, "application/json");
        assert!(
            String::from_utf8(response.body)
                .unwrap()
                .contains("invalid speech request")
        );
    }
}
