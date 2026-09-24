use base64::Engine;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::time::Duration;

const MAX_AUDIO_BYTES: usize = 32 * 1024 * 1024;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(60);

pub(super) struct PiperWorkerProcess {
    pub(super) child: tokio::sync::Mutex<Child>,
    pub(super) stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    pub(super) stdout: tokio::sync::Mutex<BufReader<ChildStdout>>,
    pub(super) operation: tokio::sync::Mutex<()>,
    pub(super) active_request: tokio::sync::Mutex<Option<ActivePiperRequest>>,
}

pub(super) struct ActivePiperRequest {
    pub(super) id: String,
    pub(super) phase: PiperRequestPhase,
}

#[derive(PartialEq, Eq)]
pub(super) enum PiperRequestPhase {
    Prepare,
    Synthesis,
}

pub(super) struct PiperAudio {
    pub(super) sample_rate: u32,
    pub(super) samples: Vec<f32>,
    pub(super) first_audio_ms: u64,
    pub(super) cpu_seconds: f64,
}

pub(super) fn piper_asset_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::voice_runtime::app_data_dir(app)?.join("speech/piper/voices"))
}

pub(super) async fn request_worker(
    worker: &PiperWorkerProcess,
    request: serde_json::Value,
    app: Option<&AppHandle>,
) -> Result<serde_json::Value, String> {
    let request_id = request
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    send_request(worker, request).await?;
    loop {
        let response = read_response(worker).await?;
        if response.get("id").and_then(serde_json::Value::as_str) != Some(request_id.as_str()) {
            continue;
        }
        if response.get("type").and_then(serde_json::Value::as_str) == Some("progress") {
            if let Some(app) = app {
                publish_download_progress(app, &response);
            }
            continue;
        }
        return Ok(response);
    }
}

pub(super) async fn send_request(
    worker: &PiperWorkerProcess,
    request: serde_json::Value,
) -> Result<(), String> {
    let mut stdin = worker.stdin.lock().await;
    let stdin = stdin
        .as_mut()
        .ok_or_else(|| "Piper Host stdin is closed".to_string())?;
    stdin
        .write_all(
            serde_json::to_string(&request)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .await
        .map_err(|error| format!("Write Piper request: {error}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

async fn read_response(worker: &PiperWorkerProcess) -> Result<serde_json::Value, String> {
    let mut stdout = worker.stdout.lock().await;
    let mut line = String::new();
    let bytes_read = tokio::time::timeout(RESPONSE_TIMEOUT, stdout.read_line(&mut line))
        .await
        .map_err(|_| "Timed out waiting for Piper Host response".to_string())?
        .map_err(|error| error.to_string())?;
    if bytes_read == 0 {
        return Err("Piper Host exited before responding".into());
    }
    serde_json::from_str(&line).map_err(|error| format!("Invalid Piper response: {error}"))
}

pub(super) async fn synthesize_audio(
    worker: &PiperWorkerProcess,
    request_id: &str,
    text: &str,
    speed: f32,
    app: &AppHandle,
) -> Result<PiperAudio, String> {
    let started = std::time::Instant::now();
    send_request(
        worker,
        serde_json::json!({
            "id":request_id, "action":"synthesize", "text":text, "speed":speed
        }),
    )
    .await?;
    let mut sample_rate = 0;
    let mut samples = Vec::new();
    let mut first_audio_ms = None;
    let mut total_bytes = 0;
    loop {
        let response = read_response(worker).await?;
        if response.get("id").and_then(serde_json::Value::as_str) != Some(request_id) {
            continue;
        }
        match response.get("type").and_then(serde_json::Value::as_str) {
            Some("progress") => publish_download_progress(app, &response),
            Some("audio") => {
                first_audio_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
                sample_rate = response
                    .get("sampleRate")
                    .and_then(serde_json::Value::as_u64)
                    .ok_or("Piper omitted sample rate")? as u32;
                if response.get("channels").and_then(serde_json::Value::as_u64) != Some(1)
                    || response.get("encoding").and_then(serde_json::Value::as_str) != Some("s16le")
                {
                    return Err("Piper returned an unsupported audio format".into());
                }
                let encoded = response
                    .get("audio")
                    .and_then(serde_json::Value::as_str)
                    .ok_or("Piper omitted audio data")?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|error| error.to_string())?;
                if bytes.len() % 2 != 0 {
                    return Err("Piper returned a partial PCM sample".into());
                }
                total_bytes += bytes.len();
                if total_bytes > MAX_AUDIO_BYTES {
                    return Err("Piper audio exceeded the 32 MiB safety limit".into());
                }
                samples.extend(
                    bytes
                        .chunks_exact(2)
                        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]) as f32 / 32768.0),
                );
            }
            Some("complete") => {
                return Ok(PiperAudio {
                    sample_rate,
                    samples,
                    first_audio_ms: first_audio_ms
                        .unwrap_or_else(|| started.elapsed().as_millis() as u64),
                    cpu_seconds: response
                        .get("cpuSeconds")
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0),
                });
            }
            Some("error") => return Err(worker_error(&response)),
            Some("cancelled") => return Err("Piper synthesis cancelled".into()),
            _ => return Err("Unexpected Piper worker response".into()),
        }
    }
}

fn publish_download_progress(app: &AppHandle, response: &serde_json::Value) {
    let payload = serde_json::json!({
        "provider":"piper", "phase":"download",
        "downloadedBytes":response.get("downloadedBytes"),
        "totalBytes":response.get("totalBytes")
    });
    if let Err(error) = app.emit("voice-runtime-progress", payload) {
        tracing::warn!("Could not publish Piper asset progress: {error}");
    }
}

pub(super) fn validate_health(response: &serde_json::Value) -> Result<(), String> {
    if response.get("type").and_then(serde_json::Value::as_str) != Some("health")
        || response.get("alive").and_then(serde_json::Value::as_bool) != Some(true)
        || response
            .get("runtimeReady")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
    {
        return Err(format!(
            "Piper Host health check failed: {}",
            worker_error(response)
        ));
    }
    let providers = response
        .get("availableProviders")
        .and_then(serde_json::Value::as_array)
        .ok_or("Piper Host did not report available ONNX providers")?;
    if !providers
        .iter()
        .any(|provider| provider.as_str() == Some("CPUExecutionProvider"))
    {
        return Err("Piper CPU ONNX provider is unavailable".into());
    }
    Ok(())
}

pub(super) fn validate_cpu_providers(response: &serde_json::Value) -> Result<(), String> {
    let providers = response
        .get("providers")
        .and_then(serde_json::Value::as_array)
        .ok_or("Piper did not report active ONNX providers")?;
    if providers.len() != 1 || providers[0].as_str() != Some("CPUExecutionProvider") {
        return Err("Piper synthesis must use CPUExecutionProvider exclusively".into());
    }
    Ok(())
}

pub(super) fn require_response(response: &serde_json::Value, expected: &str) -> Result<(), String> {
    match response.get("type").and_then(serde_json::Value::as_str) {
        Some(actual) if actual == expected => Ok(()),
        _ => Err(worker_error(response)),
    }
}

pub(super) fn worker_error(response: &serde_json::Value) -> String {
    response
        .get("message")
        .or_else(|| response.get("runtimeError"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Piper Host returned an invalid response")
        .chars()
        .take(512)
        .collect()
}
