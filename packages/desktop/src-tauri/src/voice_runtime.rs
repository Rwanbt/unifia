mod audio;
mod bootstrap;

use audio::write_wav;
use base64::Engine;
use bootstrap::{apply_runtime_environment, emit_progress, prepare_runtime};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

const WORKER_RESTART_BACKOFF: std::time::Duration = std::time::Duration::from_millis(250);

pub struct VoiceRuntime {
    process: tokio::sync::Mutex<Option<Arc<VoiceWorkerProcess>>>,
}

struct VoiceWorkerProcess {
    child: tokio::sync::Mutex<Child>,
    stdin: tokio::sync::Mutex<ChildStdin>,
    stdout: tokio::sync::Mutex<BufReader<ChildStdout>>,
    operation: tokio::sync::Mutex<()>,
    active_request: tokio::sync::Mutex<Option<String>>,
}

struct SynthesisRequest<'a> {
    text: &'a str,
    language: &'a str,
    voice: &'a str,
    voice_sample: Option<&'a Path>,
    output: &'a Path,
}

impl VoiceRuntime {
    pub fn new() -> Self {
        Self {
            process: tokio::sync::Mutex::new(None),
        }
    }

    pub fn is_supported() -> bool {
        (cfg!(target_os = "windows") && cfg!(target_arch = "x86_64"))
            || (cfg!(target_os = "linux")
                && (cfg!(target_arch = "x86_64") || cfg!(target_arch = "aarch64")))
            || (cfg!(target_os = "macos")
                && (cfg!(target_arch = "x86_64") || cfg!(target_arch = "aarch64")))
    }

    pub async fn start(&self, app: &AppHandle) -> Result<(), String> {
        let mut process = self.process.lock().await;
        if let Some(worker) = process.as_ref() {
            if worker
                .child
                .lock()
                .await
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return Ok(());
            }
            *process = None;
        }

        emit_progress(app, "runtime", "Starting the managed speech runtime");
        let (uv, project) = prepare_runtime(app).await?;
        let mut command = Command::new(uv);
        command
            .args(["run", "--locked", "--directory"])
            .arg(&project)
            .args(["python", "-m", "voice_host.worker"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        apply_runtime_environment(&mut command, app, &project)?;
        #[cfg(windows)]
        command.creation_flags(0x08000000);

        let mut child = command
            .spawn()
            .map_err(|error| format!("Start Voice Host: {error}"))?;
        let stdin = child.stdin.take().ok_or("Voice Host stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Voice Host stdout unavailable")?;
        if let Some(stderr) = child.stderr.take() {
            let progress_app = app.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!("[Voice Host] {line}");
                    if let Some((phase, message)) = worker_progress(&line) {
                        emit_progress(&progress_app, phase, message);
                    }
                }
            });
        }
        let worker = Arc::new(VoiceWorkerProcess {
            child: tokio::sync::Mutex::new(child),
            stdin: tokio::sync::Mutex::new(stdin),
            stdout: tokio::sync::Mutex::new(BufReader::new(stdout)),
            operation: tokio::sync::Mutex::new(()),
            active_request: tokio::sync::Mutex::new(None),
        });
        *process = Some(worker.clone());
        let _operation = worker.operation.lock().await;
        let health = match request_worker(
            &worker,
            serde_json::json!({"id":"health","action":"health"}),
        )
        .await
        {
            Ok(response) => response,
            Err(error) => {
                *process = None;
                return Err(error);
            }
        };
        if health.get("type").and_then(serde_json::Value::as_str) != Some("health")
            || health.get("alive").and_then(serde_json::Value::as_bool) != Some(true)
            || health
                .get("runtimeReady")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
        {
            *process = None;
            return Err("Voice Host health check failed".to_string());
        }
        let warmup = match request_worker(
            &worker,
            serde_json::json!({
                "id":"warmup-en", "action":"prepare", "language":"en", "voice":"alba"
            }),
        )
        .await
        {
            Ok(response) => response,
            Err(error) => {
                *process = None;
                return Err(error);
            }
        };
        if let Err(error) = require_response(&warmup, "prepared") {
            *process = None;
            return Err(error);
        }
        let readiness = match request_worker(
            &worker,
            serde_json::json!({"id":"readiness","action":"health"}),
        )
        .await
        {
            Ok(response) => response,
            Err(error) => {
                *process = None;
                return Err(error);
            }
        };
        if readiness
            .get("modelLoaded")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
            || readiness
                .get("voiceReady")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            || readiness
                .get("language")
                .and_then(serde_json::Value::as_str)
                != Some("en")
        {
            *process = None;
            return Err("Pocket runtime is alive but not ready for speech".into());
        }
        Ok(())
    }

    pub async fn synthesize(
        &self,
        app: &AppHandle,
        text: &str,
        language: &str,
        voice: &str,
        voice_sample: Option<&Path>,
        output: &Path,
    ) -> Result<(), String> {
        self.start(app).await?;
        let worker = self.current_worker().await?;
        let request = SynthesisRequest {
            text,
            language,
            voice,
            voice_sample,
            output,
        };
        match self.synthesize_with_worker(&worker, app, &request).await {
            Ok(()) => Ok(()),
            Err(first_error) => {
                if !Self::worker_exited(&worker).await? {
                    return Err(first_error);
                }
                self.clear_if_current(&worker).await;
                tokio::time::sleep(WORKER_RESTART_BACKOFF).await;
                self.start(app).await.map_err(|restart_error| {
                    format!("Voice Host exited ({first_error}); restart failed: {restart_error}")
                })?;
                let recovered_worker = self.current_worker().await?;
                self.synthesize_with_worker(&recovered_worker, app, &request)
                    .await
                    .map_err(|retry_error| {
                        format!("Voice Host restarted but synthesis retry failed: {retry_error}")
                    })
            }
        }
    }

    async fn synthesize_with_worker(
        &self,
        worker: &Arc<VoiceWorkerProcess>,
        app: &AppHandle,
        request: &SynthesisRequest<'_>,
    ) -> Result<(), String> {
        let _operation = worker.operation.lock().await;
        let prepared = request_worker(worker, serde_json::json!({
            "id":"prepare", "action":"prepare", "language":request.language, "voice":request.voice,
            "voiceSample":request.voice_sample,
            "voiceRoot":app.path().app_data_dir().map_err(|error| error.to_string())?.join("speech/voices")
        })).await?;
        require_response(&prepared, "prepared")?;

        let request_id = uuid::Uuid::new_v4().to_string();
        let result = synthesize_audio(worker, &request_id, request.text).await;
        *worker.active_request.lock().await = None;
        let (sample_rate, audio) = result?;
        if sample_rate == 0 || audio.is_empty() {
            return Err("Pocket produced no audio".into());
        }
        write_wav(request.output, sample_rate, &audio)
    }

    async fn current_worker(&self) -> Result<Arc<VoiceWorkerProcess>, String> {
        self.process
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "Voice Host stopped unexpectedly".into())
    }

    async fn worker_exited(worker: &VoiceWorkerProcess) -> Result<bool, String> {
        worker
            .child
            .lock()
            .await
            .try_wait()
            .map(|status| status.is_some())
            .map_err(|error| format!("Check Voice Host recovery state: {error}"))
    }

    async fn clear_if_current(&self, worker: &Arc<VoiceWorkerProcess>) {
        let mut process = self.process.lock().await;
        if process
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, worker))
        {
            *process = None;
        }
    }

    pub async fn stop(&self) -> Result<(), String> {
        let worker = self.process.lock().await.take();
        if let Some(worker) = worker {
            let mut child = worker.child.lock().await;
            if child
                .try_wait()
                .map_err(|error| format!("Check Voice Host status: {error}"))?
                .is_some()
            {
                return Ok(());
            }
            child
                .start_kill()
                .map_err(|error| format!("Stop Voice Host: {error}"))?;
            child
                .wait()
                .await
                .map_err(|error| format!("Wait for Voice Host: {error}"))?;
        }
        Ok(())
    }

    pub async fn cancel(&self) -> Result<(), String> {
        let worker = self.process.lock().await.as_ref().cloned();
        let Some(worker) = worker else {
            return Ok(());
        };
        let request_id = worker.active_request.lock().await.clone();
        let Some(request_id) = request_id else {
            return Ok(());
        };
        send_request(
            &worker,
            serde_json::json!({
                "id":uuid::Uuid::new_v4().to_string(),
                "action":"cancel",
                "requestId":request_id
            }),
        )
        .await
    }

    pub async fn invalidate_voice_clone(&self, name: &str) -> Result<(), String> {
        let worker = self.process.lock().await.as_ref().cloned();
        let Some(worker) = worker else {
            return Ok(());
        };
        if let Some(request_id) = worker.active_request.lock().await.clone() {
            send_request(
                &worker,
                serde_json::json!({
                    "id":uuid::Uuid::new_v4().to_string(),
                    "action":"cancel",
                    "requestId":request_id
                }),
            )
            .await?;
        }
        let _operation = worker.operation.lock().await;
        let response = request_worker(
            &worker,
            serde_json::json!({
                "id":uuid::Uuid::new_v4().to_string(),
                "action":"invalidate_voice",
                "voice":name
            }),
        )
        .await?;
        require_response(&response, "invalidated")
    }
}

fn worker_progress(line: &str) -> Option<(&'static str, &'static str)> {
    if line.contains("Pocket runtime import failed") {
        Some(("error", "The speech runtime could not be initialized"))
    } else if line.contains("Importing Pocket and PyTorch") {
        Some(("runtime", "Loading the speech engine"))
    } else if line.contains("Pocket and PyTorch imports ready") {
        Some(("runtime", "Speech engine initialized"))
    } else if line.contains("Loading quantized Pocket model") {
        Some((
            "model",
            "Loading the language model; first use may download model files",
        ))
    } else if line.contains("Pocket model ready") {
        Some((
            "voice",
            "Language model ready; preparing the selected voice",
        ))
    } else if line.contains("Preparing Pocket voice") {
        Some(("voice", "Preparing the selected voice"))
    } else if line.contains("Pocket voice ready") {
        Some(("voice", "Voice preparation is complete"))
    } else {
        None
    }
}

async fn request_worker(
    worker: &VoiceWorkerProcess,
    message: serde_json::Value,
) -> Result<serde_json::Value, String> {
    send_request(worker, message).await?;
    read_response(worker).await
}

async fn synthesize_audio(
    worker: &VoiceWorkerProcess,
    request_id: &str,
    text: &str,
) -> Result<(u32, Vec<f32>), String> {
    let mut stdin = worker.stdin.lock().await;
    let request = serde_json::json!({"id":request_id, "action":"synthesize", "text":text});
    stdin
        .write_all(
            serde_json::to_string(&request)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .await
        .map_err(|error| format!("Write Voice Host request: {error}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    *worker.active_request.lock().await = Some(request_id.to_string());
    stdin.flush().await.map_err(|error| error.to_string())?;
    drop(stdin);

    let mut sample_rate = 0;
    let mut audio = Vec::new();
    loop {
        let response = read_response(worker).await?;
        if response.get("id").and_then(serde_json::Value::as_str) != Some(request_id) {
            continue;
        }
        match response.get("type").and_then(serde_json::Value::as_str) {
            Some("audio") => {
                sample_rate = response
                    .get("sampleRate")
                    .and_then(serde_json::Value::as_u64)
                    .ok_or("Voice Host omitted sample rate")? as u32;
                let encoded = response
                    .get("audio")
                    .and_then(serde_json::Value::as_str)
                    .ok_or("Voice Host omitted audio data")?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|error| format!("Invalid audio frame: {error}"))?;
                if bytes.len() % 4 != 0 {
                    return Err("Invalid float PCM frame length".into());
                }
                audio.extend(
                    bytes
                        .chunks_exact(4)
                        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])),
                );
            }
            Some("complete") => return Ok((sample_rate, audio)),
            Some("error") => {
                return Err(response
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Pocket synthesis failed")
                    .to_string());
            }
            Some("cancelled") => return Err("Pocket synthesis was cancelled".into()),
            _ => return Err("Unexpected Voice Host response".into()),
        }
    }
}

async fn send_request(
    worker: &VoiceWorkerProcess,
    message: serde_json::Value,
) -> Result<(), String> {
    let serialized = serde_json::to_string(&message).map_err(|error| error.to_string())?;
    let mut stdin = worker.stdin.lock().await;
    stdin
        .write_all(serialized.as_bytes())
        .await
        .map_err(|error| format!("Write Voice Host request: {error}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

async fn read_response(worker: &VoiceWorkerProcess) -> Result<serde_json::Value, String> {
    let mut stdout = worker.stdout.lock().await;
    let mut line = String::new();
    let count = stdout
        .read_line(&mut line)
        .await
        .map_err(|error| format!("Read Voice Host response: {error}"))?;
    if count == 0 {
        return Err("Voice Host exited before responding".into());
    }
    serde_json::from_str(&line).map_err(|error| format!("Invalid Voice Host response: {error}"))
}

fn require_response(response: &serde_json::Value, expected: &str) -> Result<(), String> {
    match response.get("type").and_then(serde_json::Value::as_str) {
        Some(actual) if actual == expected => Ok(()),
        Some("error") => Err(response
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Voice Host error")
            .to_string()),
        _ => Err(format!("Expected Voice Host response '{expected}'")),
    }
}
