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
use tauri::{AppHandle, Manager};

use unifia_parakeet::{ParakeetEngine, ParakeetRecognizer};
use unifia_speech_api::{AudioChunk, AudioFormat, SpeechToText};
use crate::voice::voice_error::{self as codes, VoiceError};

fn model_dir(app: &AppHandle) -> Result<PathBuf, VoiceError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("speech").join("parakeet-tdt-0.6b-v3-int8"))
        .map_err(|error| VoiceError::session(error.to_string()))
}

// ─── State ─────────────────────────────────────────────────────────────

pub struct SpeechState {
    recognizer: ParakeetRecognizer,
    model_download: tokio::sync::Mutex<()>,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            recognizer: ParakeetRecognizer::new(),
            model_download: tokio::sync::Mutex::new(()),
        }
    }
}

// ─── STT (Parakeet via ONNX Runtime) ──────────────────────────────────

#[tauri::command]
pub async fn stt_download_model(app: AppHandle) -> Result<(), VoiceError> {
    let state = app.state::<SpeechState>();
    let _download_guard = state.model_download.lock().await;
    let spec = unifia_voice_artifacts::bundled_parakeet_spec()
        .map_err(|error| VoiceError::new(codes::MODEL_DOWNLOAD_FAILED, error))?;
    let dir = model_dir(&app)?;
    unifia_voice_artifacts::install(&spec, &dir, |_| {}).await
        .map_err(|error| VoiceError::new(codes::MODEL_DOWNLOAD_FAILED, error))
}

/// Downloads the Parakeet model at launch, with bounded retries, so the first
/// dictation or Live session never starts the download itself.
pub fn start_background_model_download(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        use crate::voice::download_retry::{delay_before_attempt, MAX_ATTEMPTS};
        for attempt in 1..=MAX_ATTEMPTS {
            if let Some(seconds) = delay_before_attempt(attempt) {
                tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
            }
            match stt_download_model(app.clone()).await {
                Ok(()) => {
                    log::info!("[STT] Parakeet model ready");
                    return;
                }
                Err(error) => {
                    log::warn!(
                        "[STT] Parakeet download attempt {attempt}/{MAX_ATTEMPTS} failed: {error}"
                    )
                }
            }
        }
        log::error!(
            "[STT] Parakeet download gave up after {MAX_ATTEMPTS} attempts; it can be retried from settings"
        );
    });
}

#[tauri::command]
pub async fn stt_load_model(app: AppHandle) -> Result<(), VoiceError> {
    if app.state::<SpeechState>().recognizer.is_loaded() {
        return Ok(());
    }

    let dir = model_dir(&app)?;
    let spec = unifia_voice_artifacts::bundled_parakeet_spec()
        .map_err(|error| VoiceError::new(codes::MODEL_LOAD_FAILED, error))?;
    if !unifia_voice_artifacts::is_installed(&spec, &dir) {
        return Err(unifia_speech_api::SpeechError::ModelMissing.into());
    }

    unifia_parakeet::onnx_runtime::ensure_compatible_runtime()
        .map_err(|error| VoiceError::new(codes::ABI_UNSUPPORTED, error))?;

    tracing::info!("[STT] Loading Parakeet model...");
    let start = std::time::Instant::now();
    let dir_clone = dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut engine = ParakeetEngine::new();
        engine.load(&dir_clone)?;
        Ok::<ParakeetEngine, String>(engine)
    })
    .await
    .map_err(|error| VoiceError::new(codes::MODEL_LOAD_FAILED, error.to_string()))?;

    let engine = result.map_err(|error| VoiceError::new(codes::MODEL_LOAD_FAILED, error))?;
    {
        let state = app.state::<SpeechState>();
        state.recognizer.install(engine);
    }
    tracing::info!("[STT] Model loaded in {:?}", start.elapsed());
    Ok(())
}

#[tauri::command]
pub async fn stt_transcribe(app: AppHandle, audio_base64: String) -> Result<String, VoiceError> {
    crate::validate::validate_bounded_text(&audio_base64, 64 * 1024 * 1024, "audio_base64")
        .map_err(VoiceError::invalid)?;
    if !app.state::<SpeechState>().recognizer.is_loaded() {
        stt_load_model(app.clone()).await?;
    }

    let audio_bytes = base64_decode(&audio_base64).map_err(VoiceError::invalid)?;
    let samples = tokio::task::spawn_blocking(move || wav_to_samples(&audio_bytes))
        .await
        .map_err(|error| VoiceError::session(error.to_string()))?
        .map_err(VoiceError::invalid)?;

    let app_clone = app.clone();
    let text = tokio::task::spawn_blocking(move || {
        let state = app_clone.state::<SpeechState>();
        state.recognizer.transcribe_samples(&samples)
    })
    .await
    .map_err(|error| VoiceError::session(error.to_string()))?
    .map_err(|error| VoiceError::new(unifia_speech_api::SpeechError::Inference.code(), error))?;

    Ok(text)
}

pub async fn stt_transcribe_pcm16k(app: AppHandle, samples: Vec<i16>) -> Result<String, VoiceError> {
    if samples.len() < 3_200 || samples.len() > 16_000 * 60 {
        return Err(VoiceError::invalid("Native PCM utterance length is outside the supported range"));
    }
    if !app.state::<SpeechState>().recognizer.is_loaded() {
        stt_load_model(app.clone()).await?;
    }
    let audio = AudioChunk::new(samples, AudioFormat::PCM16_MONO_16K);
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let state = app_clone.state::<SpeechState>();
        state.recognizer.transcribe(&audio)
    })
    .await
    .map_err(|error| VoiceError::session(error.to_string()))?
    .map(|transcript| transcript.text)
    .map_err(VoiceError::from)
}

#[tauri::command]
pub async fn stt_available(app: AppHandle) -> Result<bool, VoiceError> {
    let dir = model_dir(&app)?;
    Ok(unifia_voice_artifacts::bundled_parakeet_spec()
        .is_ok_and(|spec| unifia_voice_artifacts::is_installed(&spec, &dir)))
}

#[tauri::command]
pub async fn stt_loaded(app: AppHandle) -> bool {
    app.state::<SpeechState>().recognizer.is_loaded()
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
