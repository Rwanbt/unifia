// SPDX-License-Identifier: MIT
//! Installs the published Pocket voice packs (registry entries, #937) into the
//! app's private data directory, the first root `pocket_tts::find_pack` reads.
//! A fresh install therefore speaks without any manual model copy.

use tauri::{AppHandle, Manager};

use crate::speech::SpeechState;
use crate::voice::download_retry::{delay_before_attempt, MAX_ATTEMPTS};

/// Languages whose pack is published and installed at launch.
const INSTALLED_AT_LAUNCH: &[&str] = &["fr"];

async fn install_pack(app: &AppHandle, language: &str) -> Result<(), String> {
    let spec = unifia_voice_artifacts::bundled_pocket_spec(language)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("voice-models")
        .join("pocket")
        .join(language);
    if unifia_voice_artifacts::is_installed(&spec, &dir) {
        return Ok(());
    }
    // WHY the shared lock: a pack and the Parakeet model are both hundreds of
    // megabytes; downloading them one at a time keeps a phone usable.
    let state = app.state::<SpeechState>();
    let _download_guard = state.model_download.lock().await;
    unifia_voice_artifacts::install(&spec, &dir, |_| {}).await
}

/// Installs every launch pack in the background, with bounded retries.
pub fn start_background_install(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        for language in INSTALLED_AT_LAUNCH {
            install_with_retries(&app, language).await;
        }
    });
}

async fn install_with_retries(app: &AppHandle, language: &str) {
    for attempt in 1..=MAX_ATTEMPTS {
        if let Some(seconds) = delay_before_attempt(attempt) {
            tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
        }
        match install_pack(app, language).await {
            Ok(()) => {
                log::info!("[voice] Pocket '{language}' pack ready");
                return;
            }
            Err(error) => log::warn!(
                "[voice] Pocket '{language}' pack attempt {attempt}/{MAX_ATTEMPTS} failed: {error}"
            ),
        }
    }
    log::error!("[voice] Pocket '{language}' pack gave up after {MAX_ATTEMPTS} attempts");
}
