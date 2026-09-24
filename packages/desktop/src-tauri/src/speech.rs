#[cfg(feature = "onnx")]
use crate::util::MutexSafe;
use std::fs;
use std::path::PathBuf;
#[cfg(feature = "onnx")]
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(feature = "onnx")]
use crate::parakeet::ParakeetEngine;

#[cfg(feature = "onnx")]
const STT_MODEL_URL: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/parakeet-tdt-0.6b-v3-int8.zip";

/// Monotonic counter for chunk WAV filenames. Using only Date.now()-style
/// timestamps causes collisions when parallel tts_speak calls land in the
/// same millisecond — the second write overwrites the first and the
/// frontend ends up replaying the same audio.
static CHUNK_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

fn next_chunk_filename() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let n = CHUNK_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("chunk_{}_{}.wav", ts, n)
}

fn data_dir(app: &AppHandle) -> PathBuf {
    crate::voice_runtime::app_data_dir(app).expect("failed to resolve app data dir")
}

#[cfg(feature = "onnx")]
fn model_dir(app: &AppHandle) -> PathBuf {
    data_dir(app)
        .join("speech")
        .join("parakeet-tdt-0.6b-v3-int8")
}

fn speech_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("speech")
}

fn publish_tts_progress(app: &AppHandle, phase: &str, message: &str) {
    if let Err(error) = app.emit(
        "voice-runtime-progress",
        serde_json::json!({"phase":phase,"message":message}),
    ) {
        tracing::warn!("Could not publish speech progress: {error}");
    }
}

// ─── State ─────────────────────────────────────────────────────────────

pub struct SpeechState {
    #[cfg(feature = "onnx")]
    stt_engine: Mutex<ParakeetEngine>,
    #[cfg(feature = "onnx")]
    stt_loaded: Mutex<bool>,
    voice_runtime: crate::voice_runtime::VoiceRuntime,
}

impl SpeechState {
    pub fn new() -> Self {
        Self {
            #[cfg(feature = "onnx")]
            stt_engine: Mutex::new(ParakeetEngine::new()),
            #[cfg(feature = "onnx")]
            stt_loaded: Mutex::new(false),
            voice_runtime: crate::voice_runtime::VoiceRuntime::new(),
        }
    }

    pub(crate) fn voice_runtime(&self) -> &crate::voice_runtime::VoiceRuntime {
        &self.voice_runtime
    }
}

// ─── STT (Parakeet) ───────────────────────────────────────────────────

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn stt_download_model(app: AppHandle) -> Result<(), String> {
    let dir = model_dir(&app);
    if dir.join("encoder-model.int8.onnx").exists() {
        return Ok(());
    }

    tracing::info!("[STT] Downloading Parakeet model...");
    let _ = fs::create_dir_all(speech_dir(&app));
    let zip_path = speech_dir(&app).join("parakeet-model.zip");

    let client = reqwest::Client::new();
    let resp = client
        .get(STT_MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Download: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&zip_path)
        .await
        .map_err(|e| format!("Create: {}", e))?;
    let mut last_emit = std::time::Instant::now();
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write: {}", e))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 300 {
            let progress = if total > 0 {
                downloaded as f64 / total as f64
            } else {
                0.0
            };
            let _ = app.emit("stt-download-progress", progress);
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| format!("Flush: {}", e))?;
    drop(file);

    tracing::info!("[STT] Extracting model...");
    let zip_clone = zip_path.clone();
    let dir_clone = speech_dir(&app);
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(&zip_clone).map_err(|e| format!("Open: {}", e))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Zip: {}", e))?;
        archive
            .extract(&dir_clone)
            .map_err(|e| format!("Extract: {}", e))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task: {}", e))?
    .map_err(|e: String| e)?;

    let _ = fs::remove_file(&zip_path);
    Ok(())
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn stt_load_model(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SpeechState>();
        if *state.stt_loaded.lock_safe() {
            return Ok(());
        }
    }

    let dir = model_dir(&app);
    if !dir.join("encoder-model.int8.onnx").exists() {
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
        *state.stt_engine.lock_safe() = engine;
        *state.stt_loaded.lock_safe() = true;
    }
    tracing::info!("[STT] Model loaded in {:?}", start.elapsed());
    Ok(())
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn stt_transcribe(app: AppHandle, audio_base64: String) -> Result<String, String> {
    // Bound the base64 payload to avoid an XSS pinning the process. 64 MiB
    // of base64 decodes to ~48 MiB of PCM — well beyond any realistic
    // voice-note length the UI can record.
    crate::validate::validate_bounded_text(&audio_base64, 64 * 1024 * 1024, "audio_base64")?;
    {
        let state = app.state::<SpeechState>();
        let loaded = *state.stt_loaded.lock_safe();
        if !loaded {
            stt_load_model(app.clone()).await?;
        }
    }

    let audio_bytes = base64_decode(&audio_base64)?;
    tracing::info!("[STT] Transcribing {} bytes", audio_bytes.len());

    let samples = tokio::task::spawn_blocking(move || wav_to_samples(&audio_bytes))
        .await
        .map_err(|e| format!("Task: {}", e))?
        .map_err(|e| format!("WAV: {}", e))?;

    tracing::info!(
        "[STT] {} samples ({:.1}s)",
        samples.len(),
        samples.len() as f64 / 16000.0
    );

    let app_clone = app.clone();
    let text = tokio::task::spawn_blocking(move || {
        let state = app_clone.state::<SpeechState>();
        let mut engine = state.stt_engine.lock_safe();
        engine.transcribe(&samples)
    })
    .await
    .map_err(|e| format!("Task: {}", e))?
    .map_err(|e| format!("STT: {}", e))?;

    Ok(text)
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn stt_available(app: AppHandle) -> bool {
    model_dir(&app).join("encoder-model.int8.onnx").exists()
}

#[cfg(feature = "onnx")]
#[tauri::command]
#[specta::specta]
pub async fn stt_loaded(app: AppHandle) -> bool {
    let state = app.state::<SpeechState>();
    *state.stt_loaded.lock_safe()
}

// ─── TTS (Pocket TTS) ─────────────────────────────────────────────────

/// Starts the isolated, managed Pocket worker and verifies its health.
#[tauri::command]
#[specta::specta]
pub async fn tts_start(app: AppHandle) -> Result<u16, String> {
    match app.state::<SpeechState>().voice_runtime.start(&app).await {
        Ok(()) => {
            publish_tts_progress(&app, "ready", "Speech is ready");
            Ok(24_000)
        }
        Err(error) => {
            publish_tts_progress(&app, "error", "Speech runtime startup failed");
            Err(error)
        }
    }
}

/// Synthesize speech through the managed worker and return its WAV artifact.
#[tauri::command]
#[specta::specta]
pub async fn tts_speak(
    app: AppHandle,
    text: String,
    voice: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let (out_path, _) = synthesize_to_file(&app, &text, voice, language).await?;
    Ok(out_path.to_string_lossy().to_string())
}

pub(crate) async fn synthesize_to_file(
    app: &AppHandle,
    text: &str,
    voice: Option<String>,
    language: Option<String>,
) -> Result<(PathBuf, crate::voice_runtime::SynthesisMetrics), String> {
    // Defence in depth: the renderer should chunk long texts itself, but an
    // XSS could still feed an unbounded string. 1 MiB of UTF-8 is well above
    // any realistic spoken sentence.
    crate::validate::validate_bounded_text(text, 1024 * 1024, "tts text")?;
    if let Some(ref v) = voice {
        // We don't resolve voice names as filesystem paths here, but still
        // refuse path separators and control
        // chars as defence in depth.
        if v.len() > 128
            || v.contains('/')
            || v.contains('\\')
            || v.contains('\0')
            || v.contains('\n')
            || v.contains('\r')
        {
            return Err("invalid voice name".into());
        }
    }
    let voice_name = voice.unwrap_or_else(|| "alba".to_string());
    let language = language.unwrap_or_else(|| "en".to_string());
    if !matches!(language.as_str(), "en" | "fr" | "es" | "it" | "de") {
        return Err("unsupported speech language".into());
    }
    let start = std::time::Instant::now();
    let out_dir = speech_dir(&app).join("tts_chunks");
    fs::create_dir_all(&out_dir)
        .map_err(|error| format!("Create TTS output directory: {error}"))?;
    let out_path = out_dir.join(next_chunk_filename());
    let clone_path = speech_dir(&app)
        .join("voices")
        .join(format!("{voice_name}.wav"));
    let voice_sample = clone_path.is_file().then_some(clone_path.as_path());
    let metrics = match app
        .state::<SpeechState>()
        .voice_runtime
        .synthesize(app, text, &language, &voice_name, voice_sample, &out_path)
        .await
    {
        Ok(metrics) => metrics,
        Err(error) => {
            publish_tts_progress(app, "error", "Speech synthesis failed");
            return Err(error);
        }
    };
    publish_tts_progress(app, "ready", "Speech is ready");
    tracing::info!(
        "[TTS] Synthesized audio with voice {voice_name} in {:?}",
        start.elapsed()
    );

    Ok((out_path, metrics))
}

/// Cancel the active TTS request while keeping the managed worker available.
#[tauri::command]
#[specta::specta]
pub async fn tts_cancel(app: AppHandle) -> Result<(), String> {
    app.state::<SpeechState>().voice_runtime.cancel().await
}

/// Stop the managed TTS worker
#[tauri::command]
#[specta::specta]
pub async fn tts_stop(app: AppHandle) -> Result<(), String> {
    tracing::info!("[TTS] Stopping Pocket worker");
    app.state::<SpeechState>().voice_runtime.stop().await
}

/// Report voice-cloning support from the checkpoint loaded by Pocket.
#[tauri::command]
#[specta::specta]
pub async fn tts_voice_cloning_supported(app: AppHandle) -> Result<bool, String> {
    app.state::<SpeechState>()
        .voice_runtime
        .voice_cloning_supported(&app)
        .await
}

/// Save a voice clone WAV file for Pocket TTS
#[tauri::command]
#[specta::specta]
pub async fn tts_save_voice_clone(
    app: AppHandle,
    audio_base64: String,
    name: String,
) -> Result<String, String> {
    if !app
        .state::<SpeechState>()
        .voice_runtime
        .voice_cloning_supported(&app)
        .await?
    {
        return Err("The loaded Pocket checkpoint does not support voice cloning".into());
    }
    // Refuse path traversal (`../../../etc/passwd`) and control chars in the
    // clone name — the name is concatenated into a filename below.
    let safe_name = crate::validate::validate_voice_clone_name(&name)?.to_string();
    // Bound the base64 payload size to avoid an XSS pinning the process with
    // a multi-GiB string. 32 MiB is ~24 MiB of decoded audio — more than
    // enough for a voice sample.
    crate::validate::validate_bounded_text(&audio_base64, 32 * 1024 * 1024, "audio_base64")?;
    let dir = speech_dir(&app).join("voices");
    let _ = fs::create_dir_all(&dir);

    let audio_bytes = base64_decode(&audio_base64)?;
    let wav_path = dir.join(format!("{}.wav", safe_name));
    fs::write(&wav_path, &audio_bytes).map_err(|e| format!("Write: {}", e))?;

    tracing::info!(
        "[TTS] Saved voice clone '{}' ({} bytes)",
        safe_name,
        audio_bytes.len()
    );
    Ok(wav_path.to_string_lossy().to_string())
}

/// List saved voice clones
#[tauri::command]
#[specta::specta]
pub async fn tts_list_voice_clones(app: AppHandle) -> Vec<String> {
    let dir = speech_dir(&app).join("voices");
    let mut clones = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "wav").unwrap_or(false)
                && let Some(stem) = path.file_stem()
            {
                clones.push(stem.to_string_lossy().to_string());
            }
        }
    }
    clones
}

/// Delete a voice clone
#[tauri::command]
#[specta::specta]
pub async fn tts_delete_voice_clone(app: AppHandle, name: String) -> Result<(), String> {
    // Refuse path traversal — a deep-link / XSS could otherwise unlink
    // arbitrary files under the user's speech data directory.
    let safe_name = crate::validate::validate_voice_clone_name(&name)?.to_string();
    let voices_dir = speech_dir(&app).join("voices");
    let path = voices_dir.join(format!("{safe_name}.wav"));
    let state_cache = voices_dir.join(".pocket-state-cache").join(&safe_name);
    validate_voice_cache_deletion(&voices_dir, &state_cache)?;
    app.state::<SpeechState>()
        .voice_runtime
        .invalidate_voice_clone(&safe_name)
        .await?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Delete voice sample: {error}")),
    }
    match fs::symlink_metadata(&state_cache) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            fs::remove_file(&state_cache)
                .map_err(|error| format!("Delete voice state link: {error}"))?;
        }
        Ok(metadata) if metadata.is_dir() => {
            fs::remove_dir_all(&state_cache)
                .map_err(|error| format!("Delete voice state cache: {error}"))?;
        }
        Ok(_) => return Err("Voice state cache path is not a directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Inspect voice state cache: {error}")),
    }
    Ok(())
}

fn validate_voice_cache_deletion(
    voices_dir: &std::path::Path,
    state_cache: &std::path::Path,
) -> Result<(), String> {
    let Ok(voices_root) = fs::canonicalize(voices_dir) else {
        return Ok(());
    };
    let cache_root = voices_dir.join(".pocket-state-cache");
    if let Ok(metadata) = fs::symlink_metadata(&cache_root) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Voice state cache root is not a managed directory".into());
        }
        let resolved_cache_root = fs::canonicalize(&cache_root)
            .map_err(|error| format!("Resolve voice state cache root: {error}"))?;
        if !resolved_cache_root.starts_with(&voices_root) {
            return Err("Voice state cache root escapes managed voices".into());
        }
    }
    match fs::symlink_metadata(state_cache) {
        Ok(metadata) if metadata.file_type().is_symlink() => Ok(()),
        Ok(metadata) if metadata.is_dir() => {
            let resolved_state_cache = fs::canonicalize(state_cache)
                .map_err(|error| format!("Resolve voice state cache: {error}"))?;
            if !resolved_state_cache.starts_with(&voices_root) {
                return Err("Voice state cache escapes managed voices".into());
            }
            Ok(())
        }
        Ok(_) => Err("Voice state cache path is not a directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Inspect voice state cache: {error}")),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn tts_available() -> bool {
    crate::voice_runtime::VoiceRuntime::is_supported()
}

/// Delete all temp WAV chunk files
#[tauri::command]
#[specta::specta]
pub async fn tts_cleanup_chunks(app: AppHandle) -> Result<(), String> {
    let dir = speech_dir(&app).join("tts_chunks");
    if dir.exists()
        && let Ok(entries) = fs::read_dir(&dir)
    {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

// ─── WAV helpers ───────────────────────────────────────────────────────

#[cfg(feature = "onnx")]
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
        samples = samples
            .chunks(spec.channels as usize)
            .map(|c| c.iter().sum::<f32>() / c.len() as f32)
            .collect();
    }
    if spec.sample_rate != 16000 {
        samples = resample(&samples, spec.sample_rate as usize, 16000);
    }
    Ok(samples)
}

#[cfg(feature = "onnx")]
fn resample(samples: &[f32], from: usize, to: usize) -> Vec<f32> {
    let ratio = from as f64 / to as f64;
    let len = (samples.len() as f64 / ratio) as usize;
    (0..len)
        .map(|i| {
            let idx = i as f64 * ratio;
            let lo = idx as usize;
            let hi = (lo + 1).min(samples.len() - 1);
            let f = (idx - lo as f64) as f32;
            samples[lo] * (1.0 - f) + samples[hi] * f
        })
        .collect()
}

// ─── Base64 ────────────────────────────────────────────────────────────

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let data = input.find(',').map(|i| &input[i + 1..]).unwrap_or(input);
    let clean: Vec<u8> = data.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::new();
    let len = clean.len();
    let mut i = 0;
    while i + 3 < len {
        let a = b64val(clean[i])?;
        let b = b64val(clean[i + 1])?;
        let c = if clean[i + 2] != b'=' {
            b64val(clean[i + 2])?
        } else {
            0
        };
        let d = if clean[i + 3] != b'=' {
            b64val(clean[i + 3])?
        } else {
            0
        };
        out.push((a << 2) | (b >> 4));
        if clean[i + 2] != b'=' {
            out.push((b << 4) | (c >> 2));
        }
        if clean[i + 3] != b'=' {
            out.push((c << 6) | d);
        }
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
