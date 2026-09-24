// SPDX-License-Identifier: MIT
//! Live Voice Host supervisor (desktop).
//!
//! Owns two processes: the pinned official LiveKit SFU (provisioned and
//! checksum-verified by `livekit_server`) and the Python Live agent
//! (`python -m voice_host.live`) in the managed Voice Host environment. The
//! agent talks to the local Unifia server with the sidecar credentials. The
//! LiveKit API key and secret are generated for each host start, never
//! persisted beyond the running host, and reach the Unifia server only
//! through a user-private state file that is removed when the host stops.

use crate::livekit_server::{self, HostMode, LIVEKIT_HTTP_PORT, LIVEKIT_RTC_PORT};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use zeroize::Zeroize;

const READY_MARKER: &str = "UNIFIA_LIVE_READY";
const AGENT_READY_TIMEOUT: Duration = Duration::from_secs(240);
const STOP_GRACE: Duration = Duration::from_secs(5);
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(300);

#[derive(Clone, Debug)]
pub(crate) struct LiveOptions {
    pub mode: HostMode,
    pub cpu_profile: String,
    pub tts_provider: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VoiceLiveStatus {
    pub running: bool,
    pub mode: Option<HostMode>,
    pub url: Option<String>,
    pub lan_url: Option<String>,
    pub restarts: u32,
    pub error: Option<String>,
}

/// Per-start LiveKit key pair; wiped from memory when dropped.
struct LiveKitCredentials {
    api_key: String,
    api_secret: String,
}

impl LiveKitCredentials {
    fn generate() -> Self {
        let key = uuid::Uuid::new_v4().simple().to_string();
        Self {
            api_key: format!("APIunifia{}", &key[..12]),
            api_secret: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        }
    }
}

impl Drop for LiveKitCredentials {
    fn drop(&mut self) {
        self.api_key.zeroize();
        self.api_secret.zeroize();
    }
}

struct LiveHost {
    options: LiveOptions,
    _credentials: LiveKitCredentials,
    livekit: Child,
    agent: Child,
    agent_stdin: Option<ChildStdin>,
    url: String,
    lan_url: Option<String>,
}

#[derive(Default)]
struct Inner {
    host: Option<LiveHost>,
    restarts: Vec<Instant>,
    last_error: Option<String>,
    stopping: bool,
}

#[derive(Default)]
pub struct VoiceLiveState {
    inner: Arc<tokio::sync::Mutex<Inner>>,
    supervisor: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

pub(crate) fn live_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::voice_runtime::app_data_dir(app)?
        .join("speech")
        .join("live"))
}

async fn write_private(path: &Path, contents: &str) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    {
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options
            .open(&temporary)
            .await
            .map_err(|error| format!("Write {}: {error}", temporary.display()))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, contents.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        tokio::io::AsyncWriteExt::flush(&mut file)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::rename(&temporary, path)
        .await
        .map_err(|error| error.to_string())
}

fn port_free() -> bool {
    std::net::TcpListener::bind(("127.0.0.1", LIVEKIT_HTTP_PORT)).is_ok()
        && std::net::UdpSocket::bind(("127.0.0.1", LIVEKIT_RTC_PORT)).is_ok()
}

fn forward_lines<R>(reader: R, label: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::info!("[{label}] {line}");
        }
    });
}

async fn sidecar_endpoint(app: &AppHandle) -> Result<(String, String, String), String> {
    crate::sidecar_credentials(app)
        .await
        .ok_or_else(|| "The local Unifia server is not ready".to_string())
}

async fn spawn_livekit(
    app: &AppHandle,
    dir: &Path,
    credentials: &LiveKitCredentials,
    lan: Option<Ipv4Addr>,
) -> Result<Child, String> {
    crate::voice_runtime::bootstrap::emit_progress(
        app,
        "live",
        "Preparing the verified LiveKit server",
    );
    let binary = livekit_server::resolve_path(app).await?;
    livekit_server::verify(&binary).await?;
    if !port_free() {
        match unifia_supervisor::Supervisor::new(dir.join("leases"))
            .reclaim_port(LIVEKIT_HTTP_PORT, &binary)
        {
            unifia_supervisor::Verdict::Impostor { running_exe, .. } => {
                return Err(format!(
                    "Port {LIVEKIT_HTTP_PORT} is used by {}, which Unifia did not start",
                    running_exe.display()
                ));
            }
            _ => tokio::time::sleep(Duration::from_millis(500)).await,
        }
    }
    let config_path = dir.join("livekit.yaml");
    livekit_server::write_config(
        &config_path,
        &credentials.api_key,
        &credentials.api_secret,
        lan,
    )
    .await?;
    let log = livekit_server::open_log(&dir.join("livekit.log"))?;
    let log_err = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(&binary);
    command
        .arg("--config")
        .arg(&config_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Start LiveKit server: {error}"))?;
    if let Some(pid) = child.id()
        && let Some(children) = app.try_state::<crate::child_processes::ChildProcesses>()
    {
        children.adopt(pid);
    }
    let started = livekit_server::wait_for_server(&mut child).await;
    // The key pair lives in memory only; the config file is not needed once
    // the server has read it.
    let _ = tokio::fs::remove_file(&config_path).await;
    started?;
    Ok(child)
}

async fn spawn_agent(
    app: &AppHandle,
    options: &LiveOptions,
    credentials: &LiveKitCredentials,
    url: &str,
) -> Result<(Child, ChildStdin), String> {
    #[cfg(feature = "onnx")]
    crate::speech::stt_download_model(app.clone()).await?;
    let (server_url, username, password) = sidecar_endpoint(app).await?;
    let project = crate::voice_runtime::bootstrap::prepare_runtime(app).await?;
    let python = project.join(".venv").join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    let mut command = Command::new(python);
    command
        .current_dir(&project)
        .args(["-m", "voice_host.live", "serve"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::voice_runtime::bootstrap::apply_runtime_environment(&mut command, app, &project)?;
    let speech = crate::voice_runtime::app_data_dir(app)?.join("speech");
    command
        .env("LIVEKIT_URL", url)
        .env("LIVEKIT_API_KEY", &credentials.api_key)
        .env("LIVEKIT_API_SECRET", &credentials.api_secret)
        .env("UNIFIA_SERVER_URL", server_url)
        .env("UNIFIA_SERVER_USERNAME", username)
        .env("UNIFIA_SERVER_PASSWORD", password)
        .env(
            "UNIFIA_PARAKEET_DIR",
            speech.join("parakeet-tdt-0.6b-v3-int8"),
        )
        .env("UNIFIA_VOICE_CPU_PROFILE", &options.cpu_profile)
        .env("UNIFIA_TTS_PROVIDER", &options.tts_provider)
        .env("NO_PROXY", "127.0.0.1,localhost,::1")
        .env("no_proxy", "127.0.0.1,localhost,::1");
    match crate::voice_runtime::bootstrap::prepare_piper_runtime(app).await {
        Ok(piper) => {
            command.env("UNIFIA_PIPER_PROJECT", piper).env(
                "UNIFIA_PIPER_ASSET_DIR",
                crate::piper_runtime::protocol::piper_asset_dir(app)?,
            );
        }
        Err(error) => tracing::warn!("Piper fallback unavailable for Live: {error}"),
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Start Live agent: {error}"))?;
    if let Some(pid) = child.id()
        && let Some(children) = app.try_state::<crate::child_processes::ChildProcesses>()
    {
        children.adopt(pid);
    }
    let stdin = child.stdin.take().ok_or("Live agent stdin unavailable")?;
    if let Some(stderr) = child.stderr.take() {
        forward_lines(stderr, "Live agent");
    }
    let stdout = child.stdout.take().ok_or("Live agent stdout unavailable")?;
    let mut lines = BufReader::new(stdout).lines();
    let ready = tokio::time::timeout(AGENT_READY_TIMEOUT, async {
        while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
            if line.trim() == READY_MARKER {
                return Ok(());
            }
            tracing::info!("[Live agent] {line}");
        }
        Err("Live agent exited before it was ready".to_string())
    })
    .await
    .map_err(|_| "Live agent did not become ready".to_string())?;
    ready?;
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::info!("[Live agent] {line}");
        }
    });
    Ok((child, stdin))
}

async fn publish_state(
    dir: &Path,
    credentials: &LiveKitCredentials,
    url: &str,
    lan_url: Option<&str>,
) -> Result<(), String> {
    let mut state = serde_json::json!({
        "state": "ready",
        "url": url,
        "apiKey": credentials.api_key,
        "apiSecret": credentials.api_secret,
    });
    if let Some(lan) = lan_url {
        state["lanUrl"] = serde_json::Value::String(lan.to_string());
    }
    write_private(&dir.join("livekit.json"), &state.to_string()).await
}

async fn stop_host(dir: &Path, mut host: LiveHost) {
    let _ = tokio::fs::remove_file(dir.join("livekit.json")).await;
    let _ = tokio::fs::remove_file(dir.join("livekit.yaml")).await;
    drop(host.agent_stdin.take()); // EOF asks the agent to drain and exit
    if tokio::time::timeout(STOP_GRACE, host.agent.wait())
        .await
        .is_err()
    {
        let _ = host.agent.kill().await;
    }
    let _ = host.livekit.kill().await;
    let _ = host.livekit.wait().await;
}

async fn start_host(app: &AppHandle, options: LiveOptions) -> Result<LiveHost, String> {
    let dir = live_dir(app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| error.to_string())?;
    crate::voice_runtime::bootstrap::emit_progress(app, "live", "Starting the Live Voice Host");
    let credentials = LiveKitCredentials::generate();
    let lan = match options.mode {
        HostMode::Local => None,
        HostMode::Lan => Some(
            livekit_server::detect_private_lan_ip()
                .ok_or("No private network address is available for LAN access")?,
        ),
    };
    // Live is the playback authority; the manual Pocket worker would load a
    // second copy of the model into memory, so it is released first.
    if let Some(speech) = app.try_state::<crate::speech::SpeechState>() {
        let _ = speech.stop_tts_workers().await;
    }
    let mut livekit = spawn_livekit(app, &dir, &credentials, lan).await?;
    let url = format!("ws://127.0.0.1:{LIVEKIT_HTTP_PORT}");
    let lan_url = lan.map(|ip| format!("ws://{ip}:{LIVEKIT_HTTP_PORT}"));
    let (agent, agent_stdin) = match spawn_agent(app, &options, &credentials, &url).await {
        Ok(agent) => agent,
        Err(error) => {
            let _ = livekit.kill().await;
            return Err(error);
        }
    };
    publish_state(&dir, &credentials, &url, lan_url.as_deref()).await?;
    crate::voice_runtime::bootstrap::emit_progress(app, "ready", "Live Voice Host is ready");
    Ok(LiveHost {
        options,
        _credentials: credentials,
        livekit,
        agent,
        agent_stdin: Some(agent_stdin),
        url,
        lan_url,
    })
}

impl VoiceLiveState {
    async fn status(&self) -> VoiceLiveStatus {
        let inner = self.inner.lock().await;
        let restarts = inner.restarts.len() as u32;
        match &inner.host {
            Some(host) => VoiceLiveStatus {
                running: true,
                mode: Some(host.options.mode),
                url: Some(host.url.clone()),
                lan_url: host.lan_url.clone(),
                restarts,
                error: None,
            },
            None => VoiceLiveStatus {
                restarts,
                error: inner.last_error.clone(),
                ..Default::default()
            },
        }
    }

    fn ensure_supervisor(&self, app: &AppHandle) {
        let mut slot = self
            .supervisor
            .lock()
            .expect("voice live supervisor poisoned");
        if slot.as_ref().is_some_and(|task| !task.is_finished()) {
            return;
        }
        let inner = self.inner.clone();
        let app = app.clone();
        *slot = Some(tokio::spawn(async move { supervise(app, inner).await }));
    }

    pub(crate) async fn shutdown(&self, app: &AppHandle) {
        if let Some(task) = self
            .supervisor
            .lock()
            .expect("voice live supervisor poisoned")
            .take()
        {
            task.abort();
        }
        let host = {
            let mut inner = self.inner.lock().await;
            inner.stopping = true;
            inner.host.take()
        };
        if let (Some(host), Ok(dir)) = (host, live_dir(app)) {
            stop_host(&dir, host).await;
        }
    }
}

/// Restarts both processes after an unexpected exit, with backoff and a cap.
async fn supervise(app: AppHandle, inner: Arc<tokio::sync::Mutex<Inner>>) {
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let mut guard = inner.lock().await;
        if guard.stopping {
            return;
        }
        let Some(host) = guard.host.as_mut() else {
            continue;
        };
        let livekit_exited = matches!(host.livekit.try_wait(), Ok(Some(_)));
        let agent_exited = matches!(host.agent.try_wait(), Ok(Some(_)));
        if !livekit_exited && !agent_exited {
            continue;
        }
        let host = guard.host.take().expect("host present");
        let options = host.options.clone();
        tracing::warn!(
            livekit_exited,
            agent_exited,
            "Live Voice Host process exited; restarting"
        );
        if let Ok(dir) = live_dir(&app) {
            stop_host(&dir, host).await;
        }
        let now = Instant::now();
        guard
            .restarts
            .retain(|at| now.duration_since(*at) < RESTART_WINDOW);
        if guard.restarts.len() >= MAX_RESTARTS {
            guard.last_error = Some("The Live Voice Host keeps stopping".into());
            let _ = app.emit("voice-live-status", "failed");
            continue;
        }
        guard.restarts.push(now);
        let backoff = Duration::from_secs(1 << guard.restarts.len().min(4));
        drop(guard);
        let _ = app.emit("voice-live-status", "reconnecting");
        tokio::time::sleep(backoff).await;
        let result = start_host(&app, options).await;
        let mut guard = inner.lock().await;
        if guard.stopping {
            if let (Ok(host), Ok(dir)) = (result, live_dir(&app)) {
                stop_host(&dir, host).await;
            }
            return;
        }
        match result {
            Ok(host) => {
                guard.host = Some(host);
                guard.last_error = None;
                let _ = app.emit("voice-live-status", "ready");
            }
            Err(error) => {
                tracing::error!("Live Voice Host restart failed: {error}");
                guard.last_error = Some(error);
                let _ = app.emit("voice-live-status", "failed");
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn voice_live_start(
    app: AppHandle,
    mode: String,
    cpu_profile: String,
    tts_provider: String,
) -> Result<VoiceLiveStatus, String> {
    let state = app.state::<VoiceLiveState>();
    let options = LiveOptions {
        mode: HostMode::parse(&mode)?,
        cpu_profile: match cpu_profile.as_str() {
            "eco" | "balanced" | "fast" => cpu_profile,
            _ => "balanced".into(),
        },
        tts_provider: match tts_provider.as_str() {
            "auto" | "pocket" | "piper" => tts_provider,
            _ => "auto".into(),
        },
    };
    {
        let mut inner = state.inner.lock().await;
        inner.stopping = false;
        let reusable = inner.host.as_mut().is_some_and(|host| {
            host.options.mode == options.mode
                && host.options.cpu_profile == options.cpu_profile
                && host.options.tts_provider == options.tts_provider
                && matches!(host.livekit.try_wait(), Ok(None))
                && matches!(host.agent.try_wait(), Ok(None))
        });
        if reusable {
            drop(inner);
            return Ok(state.status().await);
        }
        if let Some(host) = inner.host.take() {
            stop_host(&live_dir(&app)?, host).await;
        }
        match start_host(&app, options).await {
            Ok(host) => {
                inner.host = Some(host);
                inner.last_error = None;
            }
            Err(error) => {
                inner.last_error = Some(error.clone());
                crate::voice_runtime::bootstrap::emit_progress(
                    &app,
                    "error",
                    "The Live Voice Host could not start",
                );
                return Err(error);
            }
        }
    }
    state.ensure_supervisor(&app);
    Ok(state.status().await)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_live_stop(app: AppHandle) -> Result<(), String> {
    app.state::<VoiceLiveState>().shutdown(&app).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn voice_live_status(app: AppHandle) -> VoiceLiveStatus {
    app.state::<VoiceLiveState>().status().await
}
