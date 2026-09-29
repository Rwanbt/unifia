// SPDX-License-Identifier: MIT

use std::path::Path;
use tauri::{AppHandle, Emitter};

const MODEL_ID: &str = "parakeet-tdt-0.6b-v3-int8";

pub(crate) fn model_is_complete(model_dir: &Path) -> bool {
    unifia_voice_artifacts::bundled_parakeet_spec()
        .is_ok_and(|spec| unifia_voice_artifacts::is_installed(&spec, model_dir))
}

pub(crate) async fn download_model(app: &AppHandle, model_dir: &Path) -> Result<(), String> {
    let spec = unifia_voice_artifacts::bundled_parakeet_spec()?;
    if spec.model_id != MODEL_ID {
        return Err("Unexpected model selected for Parakeet download".into());
    }
    let progress_app = app.clone();
    unifia_voice_artifacts::install(&spec, model_dir, move |progress| {
        if let Err(error) = progress_app.emit("stt-download-progress", progress) {
            tracing::warn!("Could not publish Parakeet download progress: {error}");
        }
    })
    .await
}
