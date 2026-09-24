use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub(crate) mod protocol;
use protocol::{
    ActivePiperRequest, PiperRequestPhase, PiperWorkerProcess, piper_asset_dir, request_worker,
    require_response, send_request, synthesize_audio, validate_cpu_providers, validate_health,
};

const RESTART_BACKOFF: std::time::Duration = std::time::Duration::from_millis(250);
const CANCEL_GRACE: std::time::Duration = std::time::Duration::from_millis(750);
const WORKER_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

struct PiperSynthesisRequest<'a> {
    app: &'a AppHandle,
    text: &'a str,
    language: &'a str,
    voice: &'a str,
    speed: f32,
    output: &'a Path,
}

pub struct PiperRuntime {
    process: tokio::sync::Mutex<Option<Arc<PiperWorkerProcess>>>,
}

impl PiperRuntime {
    pub fn new() -> Self {
        Self {
            process: tokio::sync::Mutex::new(None),
        }
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
        crate::voice_runtime::bootstrap::emit_progress(
            app,
            "piper",
            "Preparing the isolated Piper runtime",
        );
        let project = crate::voice_runtime::bootstrap::prepare_piper_runtime(app).await?;
        let python = project.join(".venv").join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });
        let mut command = Command::new(python);
        command
            .current_dir(&project)
            .args(["-m", "piper_host.worker"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        crate::voice_runtime::bootstrap::apply_runtime_environment(&mut command, app, &project)?;
        command.env("UNIFIA_PIPER_ASSET_DIR", piper_asset_dir(app)?);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Start Piper Host: {error}"))?;
        let stdin = child.stdin.take().ok_or("Piper Host stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Piper Host stdout unavailable")?;
        self.forward_stderr(app, child.stderr.take());
        let worker = Arc::new(PiperWorkerProcess {
            child: tokio::sync::Mutex::new(child),
            stdin: tokio::sync::Mutex::new(Some(stdin)),
            stdout: tokio::sync::Mutex::new(BufReader::new(stdout)),
            operation: tokio::sync::Mutex::new(()),
            active_request: tokio::sync::Mutex::new(None),
        });
        *process = Some(worker.clone());
        let health = match request_worker(
            &worker,
            serde_json::json!({"id":"health","action":"health"}),
            Some(app),
        )
        .await
        {
            Ok(health) => health,
            Err(error) => {
                *process = None;
                let mut child = worker.child.lock().await;
                if child
                    .try_wait()
                    .map_err(|wait_error| wait_error.to_string())?
                    .is_none()
                {
                    child
                        .start_kill()
                        .map_err(|kill_error| kill_error.to_string())?;
                    child
                        .wait()
                        .await
                        .map_err(|wait_error| wait_error.to_string())?;
                }
                return Err(error);
            }
        };
        if let Err(error) = validate_health(&health) {
            *process = None;
            let mut child = worker.child.lock().await;
            if child
                .try_wait()
                .map_err(|wait_error| wait_error.to_string())?
                .is_none()
            {
                child
                    .start_kill()
                    .map_err(|kill_error| kill_error.to_string())?;
                child
                    .wait()
                    .await
                    .map_err(|wait_error| wait_error.to_string())?;
            }
            return Err(error);
        }
        Ok(())
    }

    fn forward_stderr(&self, app: &AppHandle, stderr: Option<tokio::process::ChildStderr>) {
        let Some(stderr) = stderr else { return };
        let app = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::warn!(
                    "[Piper Host] {}",
                    line.chars().take(1024).collect::<String>()
                );
                if line.contains("Piper runtime import failed") {
                    crate::voice_runtime::bootstrap::emit_progress(
                        &app,
                        "error",
                        "Piper runtime initialization failed",
                    );
                }
            }
        });
    }

    pub async fn synthesize(
        &self,
        app: &AppHandle,
        text: &str,
        language: &str,
        voice: &str,
        speed: f32,
        output: &Path,
    ) -> Result<crate::voice_runtime::SynthesisMetrics, String> {
        let worker = self.get_or_start(app).await?;
        let _operation = worker.operation.lock().await;
        match self
            .synthesize_with_worker(
                &worker,
                PiperSynthesisRequest {
                    app,
                    text,
                    language,
                    voice,
                    speed,
                    output,
                },
            )
            .await
        {
            Ok(metrics) => Ok(metrics),
            Err(error) => {
                let failure_detection_started = std::time::Instant::now();
                if !Self::worker_exited(&worker).await? {
                    return Err(error);
                }
                let failure_detection_ms = failure_detection_started.elapsed().as_millis() as u64;
                self.clear_if_current(&worker).await;
                let restart_started = std::time::Instant::now();
                tokio::time::sleep(RESTART_BACKOFF).await;
                self.start(app).await.map_err(|restart| {
                    format!("Piper exited ({error}); restart failed: {restart}")
                })?;
                let restart_ms = restart_started.elapsed().as_millis() as u64;
                let retry_worker = self.current_worker().await?;
                let _retry_operation = retry_worker.operation.lock().await;
                let retry_started = std::time::Instant::now();
                let mut metrics = self
                    .synthesize_with_worker(
                        &retry_worker,
                        PiperSynthesisRequest {
                            app,
                            text,
                            language,
                            voice,
                            speed,
                            output,
                        },
                    )
                    .await
                    .map_err(|retry| {
                        format!("Piper restarted but synthesis retry failed: {retry}")
                    })?;
                metrics.failure_detection_ms = Some(failure_detection_ms);
                metrics.restart_ms = Some(restart_ms);
                metrics.retry_ms = Some(retry_started.elapsed().as_millis() as u64);
                Ok(metrics)
            }
        }
    }

    pub(crate) async fn qualification_worker_pid(&self) -> Result<u32, String> {
        let worker = self.current_worker().await?;
        worker
            .child
            .lock()
            .await
            .id()
            .ok_or_else(|| "Piper Host PID is unavailable".into())
    }

    pub(crate) async fn qualification_kill_when_busy(&self) -> Result<u32, String> {
        let worker = self.current_worker().await?;
        tokio::time::timeout(WORKER_SHUTDOWN_TIMEOUT, async {
            loop {
                if worker.active_request.lock().await.is_some() {
                    let mut child = worker.child.lock().await;
                    let pid = child
                        .id()
                        .ok_or_else(|| "Piper Host PID is unavailable".to_string())?;
                    child
                        .start_kill()
                        .map_err(|error| format!("Crash Piper Host for qualification: {error}"))?;
                    child
                        .wait()
                        .await
                        .map_err(|error| format!("Confirm Piper Host crash: {error}"))?;
                    return Ok(pid);
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .map_err(|_| "Piper Host did not start a request for crash qualification".to_string())?
    }

    pub(crate) async fn qualification_wait_until_synthesizing(&self) -> Result<(), String> {
        let worker = self.current_worker().await?;
        tokio::time::timeout(WORKER_SHUTDOWN_TIMEOUT, async {
            loop {
                if worker
                    .active_request
                    .lock()
                    .await
                    .as_ref()
                    .is_some_and(|request| request.phase == PiperRequestPhase::Synthesis)
                {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .map_err(|_| {
            "Piper Host did not start a request for cancellation qualification".to_string()
        })
    }

    async fn synthesize_with_worker(
        &self,
        worker: &Arc<PiperWorkerProcess>,
        request: PiperSynthesisRequest<'_>,
    ) -> Result<crate::voice_runtime::SynthesisMetrics, String> {
        let PiperSynthesisRequest {
            app,
            text,
            language,
            voice,
            speed,
            output,
        } = request;
        let prepare_id = uuid::Uuid::new_v4().to_string();
        *worker.active_request.lock().await = Some(ActivePiperRequest {
            id: prepare_id.clone(),
            phase: PiperRequestPhase::Prepare,
        });
        let prepared = request_worker(
            worker,
            serde_json::json!({
                "id":prepare_id, "action":"prepare", "language":language, "voice":voice
            }),
            Some(app),
        )
        .await;
        *worker.active_request.lock().await = None;
        let prepared = prepared?;
        require_response(&prepared, "prepared")?;
        validate_cpu_providers(&prepared)?;
        let request_id = uuid::Uuid::new_v4().to_string();
        *worker.active_request.lock().await = Some(ActivePiperRequest {
            id: request_id.clone(),
            phase: PiperRequestPhase::Synthesis,
        });
        let started = std::time::Instant::now();
        let audio = synthesize_audio(worker, &request_id, text, speed, app).await;
        *worker.active_request.lock().await = None;
        let audio = audio?;
        if audio.sample_rate == 0 || audio.samples.is_empty() {
            return Err("Piper produced no audio".into());
        }
        if audio.samples.iter().any(|sample| !sample.is_finite()) {
            return Err("Piper produced non-finite audio samples".into());
        }
        let samples = crate::voice_runtime::audio::resample(
            &audio.samples,
            audio.sample_rate,
            crate::voice_runtime::audio::SPEECH_SAMPLE_RATE,
        );
        let wav_started = std::time::Instant::now();
        crate::voice_runtime::audio::write_wav(
            output,
            crate::voice_runtime::audio::SPEECH_SAMPLE_RATE,
            &samples,
        )?;
        tracing::info!(
            "[TTS] Piper generated {} samples at {} Hz from {} Hz audio; first audio {} ms; CPU {:.3}s",
            samples.len(),
            crate::voice_runtime::audio::SPEECH_SAMPLE_RATE,
            audio.sample_rate,
            audio.first_audio_ms,
            audio.cpu_seconds
        );
        Ok(crate::voice_runtime::SynthesisMetrics {
            sample_rate: crate::voice_runtime::audio::SPEECH_SAMPLE_RATE,
            samples: samples.len(),
            duration_ms: started.elapsed().as_millis() as u64,
            first_audio_ms: audio.first_audio_ms,
            generation_ms: started.elapsed().as_millis() as u64,
            wav_finalize_ms: wav_started.elapsed().as_millis() as u64,
            failure_detection_ms: None,
            restart_ms: None,
            retry_ms: None,
        })
    }

    pub async fn cancel(&self) -> Result<(), String> {
        let worker = self.current_worker().await.ok();
        let Some(worker) = worker else { return Ok(()) };
        let request_id = worker
            .active_request
            .lock()
            .await
            .as_ref()
            .map(|request| request.id.clone());
        let Some(request_id) = request_id else {
            return Ok(());
        };
        send_request(
            &worker,
            serde_json::json!({
                "id":uuid::Uuid::new_v4().to_string(), "action":"cancel", "requestId":request_id
            }),
        )
        .await?;
        let stopped = tokio::time::timeout(CANCEL_GRACE, async {
            while worker
                .active_request
                .lock()
                .await
                .as_ref()
                .is_some_and(|request| request.id == request_id)
            {
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
        })
        .await
        .is_ok();
        if stopped {
            return Ok(());
        }
        self.terminate_worker(&worker).await
    }

    pub async fn stop(&self) -> Result<(), String> {
        self.cancel().await?;
        let worker = self.process.lock().await.take();
        let Some(worker) = worker else { return Ok(()) };
        let _operation = worker.operation.lock().await;
        if worker
            .child
            .lock()
            .await
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(());
        }
        let disposed = request_worker(
            &worker,
            serde_json::json!({
                "id":uuid::Uuid::new_v4().to_string(), "action":"dispose"
            }),
            None,
        )
        .await?;
        require_response(&disposed, "disposed")?;
        let shutdown_result = {
            let mut stdin = worker.stdin.lock().await;
            let Some(mut stdin) = stdin.take() else {
                return Err("Piper Host stdin was already closed".into());
            };
            stdin.shutdown().await
        };
        if let Err(error) = shutdown_result {
            self.terminate_worker(&worker).await?;
            return Err(format!("Close Piper Host stdin: {error}"));
        }
        let mut child = worker.child.lock().await;
        match tokio::time::timeout(WORKER_SHUTDOWN_TIMEOUT, child.wait()).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(error)) => Err(format!("Wait for Piper Host: {error}")),
            Err(_) => {
                child
                    .start_kill()
                    .map_err(|error| format!("Terminate unresponsive Piper Host: {error}"))?;
                child
                    .wait()
                    .await
                    .map_err(|error| format!("Confirm Piper Host exit: {error}"))?;
                Err("Piper Host did not exit after dispose; it was terminated".into())
            }
        }
    }

    async fn terminate_worker(&self, worker: &Arc<PiperWorkerProcess>) -> Result<(), String> {
        self.clear_if_current(worker).await;
        let mut child = worker.child.lock().await;
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            child
                .start_kill()
                .map_err(|error| format!("Terminate cancelled Piper Host: {error}"))?;
            child
                .wait()
                .await
                .map_err(|error| format!("Confirm Piper Host exit: {error}"))?;
        }
        Ok(())
    }

    async fn get_or_start(&self, app: &AppHandle) -> Result<Arc<PiperWorkerProcess>, String> {
        match self.current_worker().await {
            Ok(worker) if !Self::worker_exited(&worker).await? => Ok(worker),
            _ => {
                self.start(app).await?;
                self.current_worker().await
            }
        }
    }

    async fn current_worker(&self) -> Result<Arc<PiperWorkerProcess>, String> {
        self.process
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "Piper Host is not running".into())
    }

    async fn worker_exited(worker: &PiperWorkerProcess) -> Result<bool, String> {
        worker
            .child
            .lock()
            .await
            .try_wait()
            .map(|status| status.is_some())
            .map_err(|error| error.to_string())
    }

    async fn clear_if_current(&self, worker: &Arc<PiperWorkerProcess>) {
        let mut process = self.process.lock().await;
        if process
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, worker))
        {
            *process = None;
        }
    }
}
