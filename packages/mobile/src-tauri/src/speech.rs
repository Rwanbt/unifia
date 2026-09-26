//! Speech (STT + TTS) Tauri commands.
//!
//! dead_code: cross-cfg API surface — every `#[tauri::command]` in this file
//! is only registered in the invoke_handler under
//! `#[cfg(target_os = "android")]` in `lib.rs`. On host (Windows/Linux)
//! `cargo check` the module compiles but none of these symbols are called,
//! which generates 30+ dead_code warnings. Silence at module scope rather
//! than cfg-gating the entire module (we want host compile to stay honest
//! about ONNX Runtime type errors).
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::parakeet::ParakeetEngine;

/// Acquire a Mutex guard tolerantly: if poisoned (a previous holder panicked),
/// recover the guard rather than propagating. This trades the crash for a
/// warning and continued operation — the STT engine state is idempotent across
/// load/transcribe calls so a partial previous failure doesn't compromise it.
fn lock_safe<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| {
        log::warn!("[speech] recovering from poisoned mutex");
        p.into_inner()
    })
}

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

fn model_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech").join("parakeet-tdt-0.6b-v3-int8")
}

// ─── State ─────────────────────────────────────────────────────────────

pub struct SpeechState {
    stt_engine: Mutex<ParakeetEngine>,
    stt_loaded: Mutex<bool>,
    model_download: tokio::sync::Mutex<()>,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            stt_engine: Mutex::new(ParakeetEngine::new()),
            stt_loaded: Mutex::new(false),
            model_download: tokio::sync::Mutex::new(()),
        }
    }
}

// ─── STT (Parakeet via ONNX Runtime) ──────────────────────────────────

#[tauri::command]
pub async fn stt_download_model(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SpeechState>();
    let _download_guard = state.model_download.lock().await;
    let spec = unifia_voice_artifacts::bundled_parakeet_spec()?;
    let dir = model_dir(&app);
    unifia_voice_artifacts::install(&spec, &dir, |_| {}).await
}

#[tauri::command]
pub async fn stt_load_model(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SpeechState>();
        if *lock_safe(&state.stt_loaded) { return Ok(()); }
    }

    let dir = model_dir(&app);
    let spec = unifia_voice_artifacts::bundled_parakeet_spec()?;
    if !unifia_voice_artifacts::is_installed(&spec, &dir) {
        return Err("Model not downloaded".to_string());
    }

    tracing::info!("[STT] Loading Parakeet model...");
    let start = std::time::Instant::now();
    let dir_clone = dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut engine = ParakeetEngine::new();
        engine.load(&dir_clone)?;
        Ok::<ParakeetEngine, String>(engine)
    })
    .await
    .map_err(|e| format!("Task: {}", e))?;

    let engine = result?;
    {
        let state = app.state::<SpeechState>();
        *lock_safe(&state.stt_engine) = engine;
        *lock_safe(&state.stt_loaded) = true;
    }
    tracing::info!("[STT] Model loaded in {:?}", start.elapsed());
    Ok(())
}

#[tauri::command]
pub async fn stt_transcribe(app: AppHandle, audio_base64: String) -> Result<String, String> {
    crate::validate::validate_bounded_text(&audio_base64, 64 * 1024 * 1024, "audio_base64")?;
    {
        let state = app.state::<SpeechState>();
        let loaded = *lock_safe(&state.stt_loaded);
        // Guard + state go out of scope here; safe to await stt_load_model below.
        if !loaded {
            stt_load_model(app.clone()).await?;
        }
    }

    let audio_bytes = base64_decode(&audio_base64)?;
    let samples = tokio::task::spawn_blocking(move || wav_to_samples(&audio_bytes))
        .await
        .map_err(|e| format!("Task: {}", e))?
        .map_err(|e| format!("WAV: {}", e))?;

    let app_clone = app.clone();
    let text = tokio::task::spawn_blocking(move || {
        let state = app_clone.state::<SpeechState>();
        let mut engine = lock_safe(&state.stt_engine);
        engine.transcribe(&samples)
    })
    .await
    .map_err(|e| format!("Task: {}", e))?
    .map_err(|e| format!("STT: {}", e))?;

    Ok(text)
}

#[tauri::command]
pub async fn stt_available(app: AppHandle) -> bool {
    unifia_voice_artifacts::bundled_parakeet_spec()
        .is_ok_and(|spec| unifia_voice_artifacts::is_installed(&spec, &model_dir(&app)))
}

#[tauri::command]
pub async fn stt_loaded(app: AppHandle) -> bool {
    let state = app.state::<SpeechState>();
    let guard = lock_safe(&state.stt_loaded);
    let val = *guard;
    drop(guard);
    val
}

// ─── Helpers ───────────────────────────────────────────────────────────

fn wav_to_samples(wav_bytes: &[u8]) -> Result<Vec<f32>, String> {
    let cursor = std::io::Cursor::new(wav_bytes);
    let reader = hound::WavReader::new(cursor).map_err(|e| format!("WAV: {}", e))?;
    let spec = reader.spec();
    let mut samples: Vec<f32> = reader
        .into_samples::<i16>()
        .filter_map(|s| s.ok())
        .map(|s| s as f32 / 32768.0)
        .collect();
    if spec.channels > 1 {
        samples = samples.chunks(spec.channels as usize)
            .map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
    }
    if spec.sample_rate != 16000 {
        let ratio = spec.sample_rate as f64 / 16000.0;
        let len = (samples.len() as f64 / ratio) as usize;
        samples = (0..len).map(|i| {
            let idx = i as f64 * ratio;
            let lo = idx as usize;
            let hi = (lo + 1).min(samples.len() - 1);
            let f = (idx - lo as f64) as f32;
            samples[lo] * (1.0 - f) + samples[hi] * f
        }).collect();
    }
    Ok(samples)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let data = input.find(',').map(|i| &input[i + 1..]).unwrap_or(input);
    let clean: Vec<u8> = data.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::new();
    let len = clean.len();
    let mut i = 0;
    while i + 3 < len {
        let a = b64val(clean[i])?;
        let b = b64val(clean[i + 1])?;
        let c = if clean[i + 2] != b'=' { b64val(clean[i + 2])? } else { 0 };
        let d = if clean[i + 3] != b'=' { b64val(clean[i + 3])? } else { 0 };
        out.push((a << 2) | (b >> 4));
        if clean[i + 2] != b'=' { out.push((b << 4) | (c >> 2)); }
        if clean[i + 3] != b'=' { out.push((c << 6) | d); }
        i += 4;
    }
    Ok(out)
}

fn b64val(c: u8) -> Result<u8, String> {
    match c {
        b'A'..=b'Z' => Ok(c - b'A'),
        b'a'..=b'z' => Ok(c - b'a' + 26),
        b'0'..=b'9' => Ok(c - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(format!("Invalid b64: {}", c as char)),
    }
}
