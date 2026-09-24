// SPDX-License-Identifier: MIT
use crate::child_processes::ChildProcesses;
use crate::livekit_server::HostMode;
use serde::Serialize;
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
    time::timeout,
};
use uuid::Uuid;
use zeroize::Zeroize;

const LIVEKIT_URL: &str = "ws://127.0.0.1:7880";
const LIVEKIT_HTTP_URL: &str = "http://127.0.0.1:7880";
const TOKEN_LIFETIME_SECONDS: u64 = 300;
const CHILD_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const AGENT_NAME: &str = "unifia-voice-transcriber";

#[derive(Default)]
pub(crate) struct LiveKitHostState {
    session: Mutex<Option<LiveKitSession>>,
}

struct LiveKitSession {
    session_id: String,
    device_id: String,
    host_mode: HostMode,
    room_id: String,
    api_key: String,
    api_secret: String,
    server: Child,
    agent: Child,
    agent_dispatched: bool,
    config_path: PathBuf,
}

struct ConfigFileGuard(Option<PathBuf>);

impl ConfigFileGuard {
    fn persist(mut self) -> Result<PathBuf, String> {
        self.0
            .take()
            .ok_or_else(|| "LiveKit config path was already transferred".to_string())
    }
}

impl Drop for ConfigFileGuard {
    fn drop(&mut self) {
        if let Some(path) = self.0.take()
            && let Err(error) = fs::remove_file(&path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(path = %path.display(), %error, "failed to remove temporary LiveKit config");
        }
    }
}

impl Drop for LiveKitSession {
    fn drop(&mut self) {
        if let Err(error) = self.agent.start_kill() {
            tracing::warn!(%error, "failed to signal LiveKit Voice Host shutdown during drop");
        }
        if let Err(error) = self.server.start_kill() {
            tracing::warn!(%error, "failed to signal LiveKit server shutdown during drop");
        }
        if let Err(error) = fs::remove_file(&self.config_path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(path = %self.config_path.display(), %error, "failed to remove temporary LiveKit config");
        }
        self.api_key.zeroize();
        self.api_secret.zeroize();
    }
}

impl LiveKitSession {
    async fn shutdown(mut self) -> Result<(), String> {
        let agent_result = stop_child(&mut self.agent, "LiveKit Voice Host").await;
        let server_result = stop_child(&mut self.server, "LiveKit server").await;
        match (agent_result, server_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(agent), Ok(())) => Err(agent),
            (Ok(()), Err(server)) => Err(server),
            (Err(agent), Err(server)) => Err(format!("{agent}; {server}")),
        }
    }
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveVoiceGrant {
    url: String,
    token: String,
    room_id: String,
    session_id: String,
    device_id: String,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn live_voice_start(
    app: AppHandle,
    state: State<'_, LiveKitHostState>,
    children: State<'_, ChildProcesses>,
    session_id: String,
    device_id: String,
    voice_host_mode: String,
) -> Result<LiveVoiceGrant, String> {
    validate_uuid(&session_id, "session ID")?;
    validate_uuid(&device_id, "device ID")?;
    let host_mode = HostMode::parse(&voice_host_mode)?;
    let mut active = state.session.lock().await;
    if let Some(session) = active.as_mut()
        && session.session_id == session_id
        && session.device_id == device_id
        && session.host_mode == host_mode
        && session_is_alive(session).await?
    {
        ensure_agent(&app, session, &children).await?;
        return participant_grant(session);
    }
    if let Some(previous) = active.take() {
        previous.shutdown().await?;
    }
    let session = start_session(&app, session_id, device_id, host_mode, &children).await?;
    let grant = participant_grant(&session)?;
    *active = Some(session);
    Ok(grant)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn live_voice_stop(
    state: State<'_, LiveKitHostState>,
    session_id: String,
) -> Result<(), String> {
    validate_uuid(&session_id, "session ID")?;
    let mut active = state.session.lock().await;
    if active
        .as_ref()
        .is_some_and(|session| session.session_id == session_id)
        && let Some(session) = active.take()
    {
        session.shutdown().await?;
    }
    Ok(())
}

fn validate_uuid(value: &str, label: &str) -> Result<(), String> {
    let parsed = Uuid::parse_str(value).map_err(|_| format!("Invalid {label}"))?;
    if parsed.to_string() != value.to_lowercase() {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

async fn session_is_alive(session: &mut LiveKitSession) -> Result<bool, String> {
    Ok(session
        .server
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none())
}

async fn stop_child(child: &mut Child, label: &str) -> Result<(), String> {
    match child
        .try_wait()
        .map_err(|error| format!("Check {label} before shutdown: {error}"))?
    {
        Some(_) => return Ok(()),
        None => child
            .start_kill()
            .map_err(|error| format!("Stop {label}: {error}"))?,
    }
    timeout(CHILD_SHUTDOWN_TIMEOUT, child.wait())
        .await
        .map_err(|_| format!("Timed out waiting for {label} to stop"))?
        .map(|_| ())
        .map_err(|error| format!("Wait for {label} to stop: {error}"))
}

fn participant_grant(session: &LiveKitSession) -> Result<LiveVoiceGrant, String> {
    let now = crate::livekit_auth::unix_time()?;
    let token = crate::livekit_auth::create_jwt(
        &session.api_secret,
        json!({
            "iss": session.api_key,
            "sub": session.device_id,
            "nbf": now.saturating_sub(5),
            "exp": now.saturating_add(TOKEN_LIFETIME_SECONDS),
            "jti": Uuid::new_v4().to_string(),
            "video": {
                "roomJoin": true,
                "room": session.room_id,
                "canPublish": true,
                "canPublishSources": ["microphone"],
                "canPublishData": false,
                "canSubscribe": true
            }
        }),
    )?;
    Ok(LiveVoiceGrant {
        url: LIVEKIT_URL.to_string(),
        token,
        room_id: session.room_id.clone(),
        session_id: session.session_id.clone(),
        device_id: session.device_id.clone(),
    })
}

async fn start_session(
    app: &AppHandle,
    session_id: String,
    device_id: String,
    host_mode: HostMode,
    children: &ChildProcesses,
) -> Result<LiveKitSession, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let speech_dir = app_data.join("speech");
    tokio::fs::create_dir_all(&speech_dir)
        .await
        .map_err(|error| format!("Create speech directory: {error}"))?;
    let server_path = crate::livekit_server::resolve_path(app).await?;
    crate::livekit_server::verify(&server_path).await?;
    let voice_project = crate::voice_runtime::bootstrap::prepare_runtime(app).await?;
    let api_key = format!("unifia_{}", Uuid::new_v4().simple());
    let api_secret = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let room_id = format!("unifia-voice-{}", Uuid::new_v4().simple());
    let config_path = speech_dir.join(format!("livekit-{}.yaml", Uuid::new_v4().simple()));
    crate::livekit_server::write_config(&config_path, &api_key, &api_secret, host_mode).await?;
    let config_guard = ConfigFileGuard(Some(config_path.clone()));

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    tokio::fs::create_dir_all(&log_dir)
        .await
        .map_err(|error| format!("Create application log directory: {error}"))?;
    let server_log = crate::livekit_server::open_log(&log_dir.join("livekit.log"))?;
    let mut server = Command::new(&server_path)
        .arg("--config")
        .arg(&config_path)
        .stdin(Stdio::null())
        .stdout(server_log.try_clone().map_err(|error| error.to_string())?)
        .stderr(server_log)
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Start localhost LiveKit: {error}"))?;
    if let Some(pid) = server.id() {
        children.adopt(pid);
    }
    if let Err(error) = crate::livekit_server::wait_for_server(&mut server).await {
        let shutdown_error = stop_child(&mut server, "LiveKit server").await.err();
        if let Err(cleanup_error) = fs::remove_file(&config_path)
            && cleanup_error.kind() != std::io::ErrorKind::NotFound
        {
            return Err(format!(
                "{error}; failed to remove temporary config: {cleanup_error}"
            ));
        }
        return Err(shutdown_error.map_or(error.clone(), |shutdown| {
            format!("{error}; cleanup failed: {shutdown}")
        }));
    }

    let agent = match spawn_agent_worker(app, &voice_project, &api_key, &api_secret, children).await
    {
        Ok(agent) => agent,
        Err(error) => {
            let shutdown_error = stop_child(&mut server, "LiveKit server").await.err();
            if let Err(cleanup_error) = fs::remove_file(&config_path)
                && cleanup_error.kind() != std::io::ErrorKind::NotFound
            {
                return Err(format!(
                    "{error}; failed to remove temporary config: {cleanup_error}"
                ));
            }
            return Err(shutdown_error.map_or(error.clone(), |shutdown| {
                format!("{error}; cleanup failed: {shutdown}")
            }));
        }
    };
    let mut session = LiveKitSession {
        session_id,
        device_id,
        host_mode,
        room_id,
        api_key,
        api_secret,
        server,
        agent,
        agent_dispatched: false,
        config_path: config_guard.persist()?,
    };
    if let Err(error) = ensure_agent(app, &mut session, children).await {
        let shutdown_error = session.shutdown().await.err();
        return Err(shutdown_error.map_or(error.clone(), |shutdown| {
            format!("{error}; cleanup failed: {shutdown}")
        }));
    }
    Ok(session)
}

async fn ensure_agent(
    app: &AppHandle,
    session: &mut LiveKitSession,
    children: &ChildProcesses,
) -> Result<(), String> {
    if session
        .agent
        .try_wait()
        .map_err(|error| format!("Check LiveKit Voice Host: {error}"))?
        .is_some()
    {
        let voice_project = crate::voice_runtime::bootstrap::prepare_runtime(app).await?;
        session.agent = spawn_agent_worker(
            app,
            &voice_project,
            &session.api_key,
            &session.api_secret,
            children,
        )
        .await?;
        session.agent_dispatched = false;
    }
    if !session.agent_dispatched {
        dispatch_transcriber(session).await?;
        if session
            .agent
            .try_wait()
            .map_err(|error| format!("Check dispatched LiveKit Voice Host: {error}"))?
            .is_some()
        {
            return Err(
                "LiveKit Voice Host exited during dispatch; see voice-livekit-agent.log".into(),
            );
        }
        session.agent_dispatched = true;
    }
    Ok(())
}

async fn spawn_agent_worker(
    app: &AppHandle,
    voice_project: &Path,
    api_key: &str,
    api_secret: &str,
    children: &ChildProcesses,
) -> Result<Child, String> {
    let python = python_executable(voice_project);
    if !python.is_file() {
        return Err("Managed Python 3.12 Voice Host is not installed".into());
    }
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    tokio::fs::create_dir_all(&log_dir)
        .await
        .map_err(|error| format!("Create application log directory: {error}"))?;
    let agent_log = crate::livekit_server::open_log(&log_dir.join("voice-livekit-agent.log"))?;
    let agent = Command::new(python)
        .arg("-m")
        .arg("voice_host.live_agent")
        .arg("start")
        .current_dir(voice_project)
        .env("LIVEKIT_URL", LIVEKIT_URL)
        .env("LIVEKIT_API_KEY", api_key)
        .env("LIVEKIT_API_SECRET", api_secret)
        .env("LIVEKIT_AGENT_NAME", AGENT_NAME)
        .env_remove("HTTP_PROXY")
        .env_remove("HTTPS_PROXY")
        .env_remove("ALL_PROXY")
        .env_remove("http_proxy")
        .env_remove("https_proxy")
        .env_remove("all_proxy")
        .env("NO_PROXY", "localhost,127.0.0.1,::1")
        .env("no_proxy", "localhost,127.0.0.1,::1")
        .stdin(Stdio::null())
        .stdout(agent_log.try_clone().map_err(|error| error.to_string())?)
        .stderr(agent_log)
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Start Python LiveKit Voice Host: {error}"))?;
    if let Some(pid) = agent.id() {
        children.adopt(pid);
    }
    Ok(agent)
}

fn python_executable(project: &Path) -> PathBuf {
    #[cfg(windows)]
    let relative = ".venv/Scripts/python.exe";
    #[cfg(not(windows))]
    let relative = ".venv/bin/python";
    project.join(relative)
}

async fn dispatch_transcriber(session: &LiveKitSession) -> Result<(), String> {
    let now = crate::livekit_auth::unix_time()?;
    let admin_token = crate::livekit_auth::create_jwt(
        &session.api_secret,
        json!({
            "iss": session.api_key,
            "sub": "unifia-voice-backend",
            "nbf": now.saturating_sub(5),
            "exp": now.saturating_add(TOKEN_LIFETIME_SECONDS),
            "video": { "roomAdmin": true, "room": session.room_id }
        }),
    )?;
    let body = json!({"room": session.room_id, "agent_name": AGENT_NAME});
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Build local LiveKit client: {error}"))?;
    let response = client
        .post(format!(
            "{LIVEKIT_HTTP_URL}/twirp/livekit.AgentDispatchService/CreateDispatch"
        ))
        .bearer_auth(admin_token)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&body).map_err(|error| error.to_string())?)
        .send()
        .await
        .map_err(|error| format!("Dispatch local transcription agent: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "LiveKit agent dispatch failed with HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_uuid;
    use crate::livekit_auth::create_jwt;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use ring::hmac;
    use serde_json::json;

    #[test]
    fn participant_claims_are_room_scoped_and_microphone_only() {
        let secret = "backend-only-secret";
        let claims = json!({
            "iss": "ephemeral-key",
            "sub": "stable-device-uuid",
            "exp": 1234567890,
            "video": {
                "roomJoin": true,
                "room": "opaque-room-uuid",
                "canPublish": true,
                "canPublishSources": ["microphone"],
                "canPublishData": false,
                "canSubscribe": true
            }
        });
        let token = create_jwt(secret, claims.clone()).expect("JWT serializes valid JSON");
        let segments = token.split('.').collect::<Vec<_>>();
        assert_eq!(segments.len(), 3);
        let payload = URL_SAFE_NO_PAD
            .decode(segments[1])
            .expect("JWT payload is base64url");
        let decoded: serde_json::Value =
            serde_json::from_slice(&payload).expect("JWT payload is JSON");
        assert_eq!(decoded, claims);
        let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
        let signature = URL_SAFE_NO_PAD
            .decode(segments[2])
            .expect("JWT signature is base64url");
        hmac::verify(
            &key,
            format!("{}.{}", segments[0], segments[1]).as_bytes(),
            &signature,
        )
        .expect("JWT signature matches backend secret");
        assert_eq!(decoded["video"]["canPublishSources"], json!(["microphone"]));
        assert_eq!(decoded["video"]["canPublishData"], false);
        assert_eq!(decoded["video"]["room"], "opaque-room-uuid");
    }

    #[test]
    fn session_identity_rejects_non_uuid_values() {
        assert!(validate_uuid("../../project", "device ID").is_err());
        assert!(validate_uuid("7d4f7d4c-82de-484c-9952-c974a64beef0", "device ID").is_ok());
    }
}
