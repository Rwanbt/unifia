// SPDX-License-Identifier: MIT
//! Pocket TTS on Android — the router's primary local neural voice
//! (ADR-062). Wraps the C ABI of `libpocket_tts.so` (PocketTTS.cpp, MIT; see
//! gen/android/app/src/main/jni/pocket_tts/PROVENANCE.md).
//!
//! One engine is loaded per language pack; one utterance streams at a time,
//! because the engine is not reentrant. PCM leaves as raw IPC bytes:
//! `u32 LE sample rate || PCM16 LE mono`, and a zero sample rate means the
//! utterance is finished.

use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void, CString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Pocket renders 24 kHz mono (Mimi codec).
pub const POCKET_SAMPLE_RATE_HZ: u32 = 24_000;

/// Files a language pack must hold; the int8 graphs are the mobile precision.
const PACK_FILES: [&str; 7] = [
    "tokenizer.model",
    "text_conditioner.onnx",
    "mimi_encoder.onnx",
    "bos_before_voice.onnx",
    "flow_lm_main_int8.onnx",
    "flow_lm_flow_int8.onnx",
    "mimi_decoder_int8.onnx",
];
/// Voice prompt shipped with each pack, relative to its `voices/` directory.
const VOICE_FILE: &str = "voice.wav";
const LSD_STEPS: c_int = 1;
/// Pocket's autoregressive loop is latency-bound on the big cores; leave the
/// rest of the SoC to audio, STT and the local LLM.
const NUM_THREADS: c_int = 2;

/// Sampling temperature for a language pack.
///
/// The section 24 gate compares an ONNX render against `reference-<lang>.wav`,
/// which is a *single* eager PyTorch sample taken at the model config's
/// `default_temperature`. Both sides sample, so the gate has a pass rate rather
/// than a boolean, and a single PASS is not evidence. Measured on the PC over
/// repeated int8 renders (`.build-temp/pocket-export/repeat-t*.json`):
///
/// | lang | 0.3 | 0.5 | 0.7 | config `default_temperature` |
/// |------|-----|-----|-----|----------------------------|
/// | en   | 3/3 | 2/3 | --  | 0.3 (`english.yaml`)        |
/// | fr   | 2/4 | 4/4 | fail| 0.7 (inherited)             |
/// | de   | 2/3 | 3/3 | 3/3 | 0.7 (inherited)             |
/// | it   | 2/3 | 0/3 | 3/3 | 0.7 (inherited)             |
///
/// English, German and Italian all gate best at exactly their own config
/// value, so those are inherited rather than tuned. French is the one pack
/// whose ONNX port does not track its config: at the inherited 0.7 the 24-layer
/// graph truncates (-12% to -27% duration), so it is overridden to 0.5, the
/// only setting measured to pass 4/4. Do not "unify" this to a single
/// constant: 0.5 fails Italian 0/3 and 0.7 fails French outright.
fn temperature_for(language: &str) -> f32 {
    match language {
        "en" => 0.3,
        "fr" => 0.5,
        _ => 0.7,
    }
}

type Create = unsafe extern "C" fn(
    *const c_char,
    *const c_char,
    *const c_char,
    *const c_char,
    f32,
    c_int,
    c_int,
) -> *mut c_void;
type Destroy = unsafe extern "C" fn(*mut c_void);
type Warmup = unsafe extern "C" fn(*mut c_void) -> f64;
type StreamStart = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> *mut c_void;
type StreamRead = unsafe extern "C" fn(*mut c_void, *mut *mut f32, *mut c_int) -> c_int;
type StreamEnd = unsafe extern "C" fn(*mut c_void);
type FreeAudio = unsafe extern "C" fn(*mut f32);

struct PocketApi {
    _library: libloading::Library,
    create: Create,
    destroy: Destroy,
    warmup: Warmup,
    stream_start: StreamStart,
    stream_read: StreamRead,
    stream_end: StreamEnd,
    free_audio: FreeAudio,
}

impl PocketApi {
    fn load() -> Result<Self, String> {
        // SAFETY: libpocket_tts.so ships in this APK and exports the ptt_* C ABI
        // declared above; the Library outlives every copied symbol.
        unsafe {
            let library = libloading::Library::new("libpocket_tts.so")
                .map_err(|e| format!("POCKET_UNAVAILABLE: load libpocket_tts.so: {e}"))?;
            macro_rules! symbol {
                ($name:literal) => {
                    *library
                        .get($name)
                        .map_err(|e| format!("POCKET_UNAVAILABLE: resolve symbol: {e}"))?
                };
            }
            Ok(Self {
                create: symbol!(b"ptt_create\0"),
                destroy: symbol!(b"ptt_destroy\0"),
                warmup: symbol!(b"ptt_warmup\0"),
                stream_start: symbol!(b"ptt_stream_start\0"),
                stream_read: symbol!(b"ptt_stream_read\0"),
                stream_end: symbol!(b"ptt_stream_end\0"),
                free_audio: symbol!(b"ptt_free_audio\0"),
                _library: library,
            })
        }
    }
}

/// A native stream context. Its mutex serialises `read` and `end`: the C ABI
/// frees the context in `end`, so it must never run while a `read` waits on it.
struct PocketStream(Mutex<Option<usize>>);

struct PocketEngine {
    api: Arc<PocketApi>,
    handle: usize,
    language: String,
}

impl Drop for PocketEngine {
    fn drop(&mut self) {
        // SAFETY: handle came from ptt_create of the same library and is
        // destroyed exactly once, after every stream of it has ended.
        unsafe { (self.api.destroy)(self.handle as *mut c_void) };
    }
}

#[derive(Default)]
pub struct PocketState {
    engine: Mutex<Option<PocketEngine>>,
    streams: Mutex<HashMap<u64, Arc<PocketStream>>>,
    next_stream: AtomicU64,
}

impl PocketState {
    fn end_all_streams(&self, api: &PocketApi) -> Result<(), String> {
        let streams: Vec<_> = self
            .streams
            .lock()
            .map_err(|_| "POCKET_FAILED: stream table poisoned")?
            .drain()
            .map(|(_, stream)| stream)
            .collect();
        for stream in streams {
            end_stream(api, &stream)?;
        }
        Ok(())
    }
}

fn end_stream(api: &PocketApi, stream: &PocketStream) -> Result<(), String> {
    let mut context = stream
        .0
        .lock()
        .map_err(|_| "POCKET_FAILED: stream poisoned")?;
    if let Some(ctx) = context.take() {
        // SAFETY: ctx came from ptt_stream_start and is ended exactly once; the
        // lock guarantees no ptt_stream_read is using it.
        unsafe { (api.stream_end)(ctx as *mut c_void) };
    }
    Ok(())
}

/// Returns the first directory holding a complete pack for `language`.
pub fn find_pack(roots: &[PathBuf], language: &str) -> Result<PathBuf, String> {
    for root in roots {
        let pack = root.join("voice-models").join("pocket").join(language);
        let complete = PACK_FILES.iter().all(|file| pack.join(file).is_file())
            && pack.join("voices").join(VOICE_FILE).is_file();
        if complete {
            return Ok(pack);
        }
    }
    Err(format!(
        "POCKET_MODEL_MISSING: no complete Pocket pack for '{language}' (needs {} and voices/{VOICE_FILE})",
        PACK_FILES.join(", ")
    ))
}

/// PCM16 IPC payload for one float chunk.
pub fn encode_chunk(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + samples.len() * 2);
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn c_string(value: &str, what: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| format!("POCKET_FAILED: {what} contains a NUL byte"))
}

fn path_string(path: &Path) -> Result<CString, String> {
    c_string(&path.to_string_lossy(), "path")
}

#[cfg(target_os = "android")]
fn external_files_dir() -> Option<PathBuf> {
    use jni::objects::{JObject, JValue};
    let ctx = ndk_context::android_context();
    // SAFETY: ndk_context is populated by the Tauri runtime before commands run;
    // the VM and activity pointers stay valid for the process lifetime.
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    // A thrown Java exception stays pending until cleared, and any further JNI
    // call with one pending aborts the process: check after every call.
    let dir = env.call_method(
        &activity,
        "getExternalFilesDir",
        "(Ljava/lang/String;)Ljava/io/File;",
        &[JValue::Object(&JObject::null())],
    );
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return None;
    }
    let dir = dir
        .and_then(|value| value.l())
        .ok()
        .filter(|value| !value.is_null())?;
    let path = env.call_method(&dir, "getAbsolutePath", "()Ljava/lang/String;", &[]);
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return None;
    }
    let path = path
        .and_then(|value| value.l())
        .ok()
        .filter(|value| !value.is_null())?;
    env.get_string((&path).into())
        .ok()
        .map(|s| PathBuf::from(String::from(s)))
}

#[cfg(not(target_os = "android"))]
fn external_files_dir() -> Option<PathBuf> {
    None
}

/// Pack roots, most trusted first: the app's private data directory (where
/// the model registry installs), then its external files directory.
fn pack_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        roots.push(dir);
    }
    if let Some(dir) = external_files_dir() {
        roots.push(dir);
    }
    roots
}

/// Loads (or keeps) the Pocket engine for `language`. Idempotent.
#[tauri::command]
pub async fn voice_pocket_prepare(app: tauri::AppHandle, language: String) -> Result<(), String> {
    use tauri::Manager;
    let roots = pack_roots(&app);
    // Loading ~140 MB of graphs blocks for a second or more: keep it off the
    // async runtime's worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        prepare_engine(&app.state::<PocketState>(), &roots, language)
    })
    .await
    .map_err(|e| format!("POCKET_FAILED: worker: {e}"))?
}

fn prepare_engine(state: &PocketState, roots: &[PathBuf], language: String) -> Result<(), String> {
    let mut engine = state
        .engine
        .lock()
        .map_err(|_| "POCKET_FAILED: engine poisoned")?;
    if engine.as_ref().is_some_and(|e| e.language == language) {
        return Ok(());
    }
    let pack = find_pack(roots, &language)?;
    let api = match engine.as_ref() {
        Some(current) => {
            state.end_all_streams(&current.api)?;
            Arc::clone(&current.api)
        }
        None => Arc::new(PocketApi::load()?),
    };
    *engine = None;
    let models = path_string(&pack)?;
    let voices = path_string(&pack.join("voices"))?;
    let tokenizer = path_string(&pack.join("tokenizer.model"))?;
    let precision = c_string("int8", "precision")?;
    let temperature = temperature_for(&language);
    // SAFETY: every pointer is a live NUL-terminated string for the call.
    let handle = unsafe {
        (api.create)(
            models.as_ptr(),
            voices.as_ptr(),
            tokenizer.as_ptr(),
            precision.as_ptr(),
            temperature,
            LSD_STEPS,
            NUM_THREADS,
        )
    };
    if handle.is_null() {
        return Err(format!(
            "POCKET_MODEL_LOAD_FAILED: the '{language}' pack did not load"
        ));
    }
    // SAFETY: handle is the engine just created.
    let warmup_ms = unsafe { (api.warmup)(handle) };
    log::info!(
        "[voice] Pocket '{language}' loaded, warmup {warmup_ms:.0} ms \
         (temperature {temperature})"
    );
    *engine = Some(PocketEngine {
        api,
        handle: handle as usize,
        language,
    });
    Ok(())
}

/// Starts synthesising `text` with the prepared engine; returns a stream id.
#[tauri::command]
pub fn voice_pocket_stream_start(
    state: tauri::State<'_, PocketState>,
    text: String,
) -> Result<u64, String> {
    let engine = state
        .engine
        .lock()
        .map_err(|_| "POCKET_FAILED: engine poisoned")?;
    let engine = engine.as_ref().ok_or_else(|| {
        "POCKET_FAILED: voice_pocket_stream_start before voice_pocket_prepare".to_owned()
    })?;
    // One utterance at a time: the engine is not reentrant.
    state.end_all_streams(&engine.api)?;
    let text = c_string(&text, "text")?;
    let voice = c_string(VOICE_FILE, "voice")?;
    // SAFETY: handle is a live engine; both strings live for the call.
    let ctx = unsafe {
        (engine.api.stream_start)(engine.handle as *mut c_void, text.as_ptr(), voice.as_ptr())
    };
    if ctx.is_null() {
        return Err("POCKET_FAILED: synthesis did not start".to_owned());
    }
    let id = state.next_stream.fetch_add(1, Ordering::Relaxed);
    state
        .streams
        .lock()
        .map_err(|_| "POCKET_FAILED: stream table poisoned")?
        .insert(id, Arc::new(PocketStream(Mutex::new(Some(ctx as usize)))));
    Ok(id)
}

/// Blocks until the next PCM chunk of stream `id`; a zero sample rate marks
/// the end of the utterance (or a stream already ended by a cancel).
#[tauri::command]
pub async fn voice_pocket_stream_read(
    state: tauri::State<'_, PocketState>,
    id: u64,
) -> Result<tauri::ipc::Response, String> {
    let api = match state
        .engine
        .lock()
        .map_err(|_| "POCKET_FAILED: engine poisoned")?
        .as_ref()
    {
        Some(engine) => Arc::clone(&engine.api),
        None => return Ok(tauri::ipc::Response::new(encode_chunk(0, &[]))),
    };
    let stream = state
        .streams
        .lock()
        .map_err(|_| "POCKET_FAILED: stream table poisoned")?
        .get(&id)
        .cloned();
    let Some(stream) = stream else {
        return Ok(tauri::ipc::Response::new(encode_chunk(0, &[])));
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let context = stream
            .0
            .lock()
            .map_err(|_| "POCKET_FAILED: stream poisoned")?;
        let Some(ctx) = *context else {
            return Ok(encode_chunk(0, &[]));
        };
        let mut samples: *mut f32 = std::ptr::null_mut();
        let mut length: c_int = 0;
        // SAFETY: ctx is live while the stream lock is held (end takes it).
        let status = unsafe { (api.stream_read)(ctx as *mut c_void, &mut samples, &mut length) };
        if status != 1 || samples.is_null() {
            return Ok::<_, String>(encode_chunk(0, &[]));
        }
        let count = usize::try_from(length).unwrap_or(0);
        // SAFETY: the runtime returned `length` floats at `samples`, which we
        // own until ptt_free_audio.
        let chunk = unsafe { std::slice::from_raw_parts(samples, count) };
        let bytes = encode_chunk(POCKET_SAMPLE_RATE_HZ, chunk);
        // SAFETY: samples was allocated by the runtime for this read.
        unsafe { (api.free_audio)(samples) };
        Ok(bytes)
    })
    .await
    .map_err(|e| format!("POCKET_FAILED: worker: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Stops and releases stream `id`. Idempotent.
#[tauri::command]
pub async fn voice_pocket_stream_end(
    state: tauri::State<'_, PocketState>,
    id: u64,
) -> Result<(), String> {
    let api = match state
        .engine
        .lock()
        .map_err(|_| "POCKET_FAILED: engine poisoned")?
        .as_ref()
    {
        Some(engine) => Arc::clone(&engine.api),
        None => return Ok(()),
    };
    let stream = state
        .streams
        .lock()
        .map_err(|_| "POCKET_FAILED: stream table poisoned")?
        .remove(&id);
    if let Some(stream) = stream {
        // May wait for one in-flight read to deliver its chunk.
        tauri::async_runtime::spawn_blocking(move || end_stream(&api, &stream))
            .await
            .map_err(|e| format!("POCKET_FAILED: worker: {e}"))??;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_is_rate_then_clamped_pcm16() {
        let bytes = encode_chunk(24_000, &[0.5, -1.5, 1.0]);
        assert_eq!(&bytes[..4], &24_000u32.to_le_bytes());
        let pcm: Vec<i16> = bytes[4..]
            .chunks(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        assert_eq!(pcm, vec![16_384, -32_767, 32_767]);
    }

    #[test]
    fn a_pack_is_found_only_when_complete() {
        let root = std::env::temp_dir().join(format!("pocket-pack-{}", std::process::id()));
        let pack = root.join("voice-models/pocket/fr");
        std::fs::create_dir_all(pack.join("voices")).expect("create pack");
        for file in &PACK_FILES[..6] {
            std::fs::write(pack.join(file), b"x").expect("write file");
        }
        std::fs::write(pack.join("voices").join(VOICE_FILE), b"x").expect("write voice");

        let missing = find_pack(std::slice::from_ref(&root), "fr").expect_err("one file missing");
        assert!(missing.starts_with("POCKET_MODEL_MISSING"), "{missing}");

        std::fs::write(pack.join(PACK_FILES[6]), b"x").expect("write last file");
        assert_eq!(
            find_pack(std::slice::from_ref(&root), "fr").expect("complete"),
            pack
        );
        std::fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn sampling_temperature_is_per_language_not_one_constant() {
        // Pinned from the section 24 gate runs recorded in
        // `temperature_for`. English follows english.yaml's
        // `default_temperature: 0.3`; the inherited 0.7 serves the 6-layer
        // packs; French is the one measured override.
        assert_eq!(temperature_for("en"), 0.3);
        assert_eq!(temperature_for("fr"), 0.5);
        for language in ["de", "it", "es", "pt", "de-AT"] {
            assert_eq!(temperature_for(language), 0.7, "{language}");
        }
    }

    #[test]
    fn an_unknown_language_falls_back_rather_than_going_silent() {
        // A pack folder with no tuned value must still render: the router
        // promises Pocket audio or an explicit failure, never a zero sample
        // rate by accident.
        let temperature = temperature_for("xx");
        assert!(temperature > 0.0, "temperature must be positive");
        assert!(temperature.is_finite(), "temperature must be finite");
    }
}
