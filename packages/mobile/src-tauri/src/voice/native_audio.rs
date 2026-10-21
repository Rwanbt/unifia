// SPDX-License-Identifier: MIT
//! Android Oboe capture and playback bridge.

use std::ffi::c_void;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::dictation_rules::{self, DictationBuffer, Entry, Owner};
use super::mic_activity::Meter;
use super::playback_trace::{PlaybackTrace, Stage};
use super::preview_cadence::{next_due, PREVIEW_WINDOW_MS};
use super::resample::Decimator;
use super::seam_merge::{merge, SEAM_WORDS};
use super::stream_chunker;

use super::capture_segmenter::*;
use libloading::Library;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

const CAPTURE_CHUNK_FRAMES: usize = 960;

type Create = unsafe extern "C" fn() -> *mut c_void;
type Destroy = unsafe extern "C" fn(*mut c_void);
type Open = unsafe extern "C" fn(*mut c_void) -> i32;
type Close = unsafe extern "C" fn(*mut c_void);
type Read = unsafe extern "C" fn(*mut c_void, *mut i16, u32) -> u32;
type Write = unsafe extern "C" fn(*mut c_void, *const i16, u32) -> u32;
type GetStats = unsafe extern "C" fn(*mut c_void, *mut NativeStats);
type TraceEnable = unsafe extern "C" fn(*mut c_void, u32);
type TraceRead = unsafe extern "C" fn(*mut c_void, *mut i16, u32, *mut PlaybackTraceStats) -> u32;

#[repr(C)]
#[derive(Default)]
struct PlaybackTraceStats {
    output_frames: u64,
    dropped_samples: u32,
    max_callback_frames: u32,
}

#[repr(C)]
#[derive(Default)]
struct NativeStats {
    audio_clock_frames: i64,
    sample_rate: i32,
    frames_per_burst: i32,
    xrun_count: i32,
    last_error: i32,
    capture_overflows: u32,
    playback_overflows: u32,
    playback_empty_samples: u32,
}

struct NativeApi {
    _library: Library,
    create: Create,
    destroy: Destroy,
    open: Open,
    close: Close,
    read: Read,
    write: Write,
    get_stats: GetStats,
    trace_enable: TraceEnable,
    trace_read: TraceRead,
}

impl NativeApi {
    fn load() -> Result<Self, String> {
        // SAFETY: The library ships in this Android app and its C ABI is defined
        // by voice_audio_engine.cpp. The Library stays alive for every symbol.
        unsafe {
            let library = Library::new("libvoice_audio.so")
                .map_err(|error| format!("load Android audio library: {error}"))?;
            let create = *library
                .get::<Create>(b"voice_audio_create\0")
                .map_err(|error| format!("resolve voice_audio_create: {error}"))?;
            let destroy = *library
                .get::<Destroy>(b"voice_audio_destroy\0")
                .map_err(|error| format!("resolve voice_audio_destroy: {error}"))?;
            let open = *library
                .get::<Open>(b"voice_audio_open\0")
                .map_err(|error| format!("resolve voice_audio_open: {error}"))?;
            let close = *library
                .get::<Close>(b"voice_audio_close\0")
                .map_err(|error| format!("resolve voice_audio_close: {error}"))?;
            let read = *library
                .get::<Read>(b"voice_audio_read\0")
                .map_err(|error| format!("resolve voice_audio_read: {error}"))?;
            let write = *library
                .get::<Write>(b"voice_audio_write\0")
                .map_err(|error| format!("resolve voice_audio_write: {error}"))?;
            let get_stats = *library
                .get::<GetStats>(b"voice_audio_stats\0")
                .map_err(|error| format!("resolve voice_audio_stats: {error}"))?;
            let trace_enable = *library
                .get::<TraceEnable>(b"voice_audio_trace_enable\0")
                .map_err(|error| format!("resolve voice_audio_trace_enable: {error}"))?;
            let trace_read = *library
                .get::<TraceRead>(b"voice_audio_trace_read\0")
                .map_err(|error| format!("resolve voice_audio_trace_read: {error}"))?;
            Ok(Self {
                _library: library,
                create,
                destroy,
                open,
                close,
                read,
                write,
                get_stats,
                trace_enable,
                trace_read,
            })
        }
    }
}

struct NativeSession {
    api: NativeApi,
    handle: usize,
    segmenter: CaptureSegmenter,
    vad: Option<super::vad::SileroVad>,
    smart_turn: Option<super::smart_turn::SmartTurn>,
    trace: Option<Arc<PlaybackTrace>>,
    /// Single owner of the session: Live or a dictation. Never shared, see `dictation_rules`.
    owner: Owner,
    /// 48 kHz → 16 kHz filter state, kept across polls so chunking never changes the output.
    decimator: Decimator,
    /// Audio position, in milliseconds, where the next live preview is due.
    preview_due_ms: u64,
    /// Level and silence tracking of the running dictation.
    meter: Meter,
    /// 16 kHz mono capture of the running dictation; `None` when no dictation runs.
    dictation: Option<DictationBuffer>,
}

impl Drop for NativeSession {
    fn drop(&mut self) {
        // Stop callbacks before draining their final samples, but retain the
        // engine and its library until the trace reader has finished.
        unsafe { (self.api.close)(self.handle as *mut c_void) };
        drain_trace(self);
        // SAFETY: handle was created by this API and is destroyed once here.
        unsafe { (self.api.destroy)(self.handle as *mut c_void) };
    }
}

#[derive(Default)]
pub struct NativeAudioState(Mutex<Option<NativeSession>>);

impl NativeAudioState {
    pub(super) fn trace(&self, id: u64) -> Result<Option<Arc<PlaybackTrace>>, String> {
        let current = self
            .0
            .lock()
            .map_err(|_| "Android audio state is poisoned")?;
        let Some(session) = current.as_ref() else {
            return Ok(None);
        };
        let Some(trace) = session.trace.as_ref().filter(|trace| !trace.expired()) else {
            return Ok(None);
        };
        trace.begin(id);
        // SAFETY: session owns the handle and library while current is locked.
        unsafe { (session.api.trace_enable)(session.handle as *mut c_void, 1) };
        Ok(Some(Arc::clone(trace)))
    }
}

fn drain_trace(session: &NativeSession) {
    let Some(trace) = &session.trace else {
        return;
    };
    let mut samples = [0_i16; 4096];
    let mut stats = PlaybackTraceStats::default();
    // Bounded drain: the ring holds at most 65535 mono samples. Diagnostics
    // overflow is counted, never allowed to block the playback callback.
    for _ in 0..16 {
        let count = unsafe {
            (session.api.trace_read)(
                session.handle as *mut c_void,
                samples.as_mut_ptr(),
                samples.len() as u32,
                &mut stats,
            )
        } as usize;
        if count > samples.len() {
            trace.metric("invalid-native-trace-count", count as u64);
            break;
        }
        if count == 0 {
            break;
        }
        trace.samples(Stage::Rendered, &samples[..count]);
    }
    trace.metric("output-total-frames", stats.output_frames);
    trace.metric(
        "native-trace-dropped-samples",
        u64::from(stats.dropped_samples),
    );
    trace.metric("max-callback-frames", u64::from(stats.max_callback_frames));
    if trace.expired() {
        unsafe { (session.api.trace_enable)(session.handle as *mut c_void, 0) };
    }
}

fn prepare_trace(app: &AppHandle) -> Option<Arc<PlaybackTrace>> {
    #[cfg(target_os = "android")]
    let root = std::path::PathBuf::from("/sdcard/Android/data")
        .join(&app.config().identifier)
        .join("files");
    #[cfg(not(target_os = "android"))]
    let root = match app.path().app_data_dir() {
        Ok(root) => root,
        Err(error) => {
            log::warn!("[voice] trace path unavailable: {error}");
            return None;
        }
    };
    match PlaybackTrace::from_marker(root) {
        Ok(trace) => trace,
        Err(error) => {
            log::warn!("[voice] PCM trace unavailable: {error}");
            None
        }
    }
}

#[derive(Serialize)]
pub struct AudioPoll {
    speaking: bool,
    /// True once the running dictation has reached one minute: the client must finish it.
    dictation_full: bool,
    /// True when a live preview of the running dictation is due.
    preview_due: bool,
    /// Smoothed microphone level of the running dictation, in `0.0..=1.0`.
    level: f32,
    /// True when the dictation should stop: speech was heard and silence lasted long enough.
    auto_stop: bool,
    utterance_id: Option<String>,
    audio_clock_ms: u64,
    sample_rate: i32,
    frames_per_burst: i32,
    xrun_count: i32,
    last_error: i32,
    capture_overflows: u32,
    playback_overflows: u32,
    playback_empty_samples: u32,
    vad_provider: &'static str,
    vad_fallback: bool,
    turn_detector: &'static str,
    turn_detector_fallback: bool,
    turn_gate_evaluations: u32,
    turn_gate_vetoes: u32,
    turn_gate_forced: u32,
}

#[tauri::command]
pub fn voice_audio_open(app: AppHandle, state: State<'_, NativeAudioState>) -> Result<(), String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    match dictation_rules::open_live(current.as_ref().map(|session| session.owner)) {
        Entry::Attach => Ok(()),
        Entry::Refuse(message) => Err(message.to_string()),
        Entry::Open(owner) => {
            *current = Some(open_session(&app, owner)?);
            Ok(())
        }
    }
}

/// Loads the voice models and opens the Oboe streams. The caller owns the returned session.
fn open_session(app: &AppHandle, owner: Owner) -> Result<NativeSession, String> {
    let models_dir = match app.path().app_data_dir() {
        Ok(directory) => Some(directory.join("voice-models")),
        Err(error) => {
            log::warn!("[voice] app data path unavailable; using RMS VAD fallback: {error}");
            None
        }
    };
    let vad =
        models_dir
            .as_ref()
            .and_then(|directory| match super::vad::SileroVad::load(directory) {
                Ok(vad) => Some(vad),
                Err(error) => {
                    log::warn!("[voice] Silero VAD unavailable; using RMS fallback: {error}");
                    None
                }
            });
    let smart_turn = models_dir.as_ref().and_then(|directory| {
        match super::smart_turn::SmartTurn::load(directory) {
            Ok(turn) => Some(turn),
            Err(error) => {
                log::warn!(
                    "[voice] Smart Turn gate unavailable; deterministic EOT fallback: {error}"
                );
                None
            }
        }
    });
    let api = NativeApi::load()?;
    // SAFETY: The opaque handle is owned by NativeSession and used only through
    // function pointers from the same loaded library.
    let handle = unsafe { (api.create)() };
    if handle.is_null() {
        return Err("Oboe could not allocate an audio engine".into());
    }
    let result = unsafe { (api.open)(handle) };
    if result != 0 {
        unsafe { (api.destroy)(handle) };
        return Err(format!(
            "Oboe failed to open capture/playback streams ({result})"
        ));
    }
    Ok(NativeSession {
        api,
        handle: handle as usize,
        segmenter: CaptureSegmenter::new(),
        vad,
        smart_turn,
        trace: prepare_trace(app),
        owner,
        decimator: Decimator::new(),
        preview_due_ms: next_due(0),
        meter: Meter::new(),
        dictation: None,
    })
}

#[tauri::command]
pub fn voice_audio_close(state: State<'_, NativeAudioState>) -> Result<(), String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    match dictation_rules::close_session(current.as_ref().map(|session| session.owner)) {
        dictation_rules::Close::Nothing => Ok(()),
        dictation_rules::Close::Close => {
            drop(current.take());
            Ok(())
        }
        dictation_rules::Close::Refuse(message) => Err(message.to_string()),
    }
}

#[tauri::command]
pub fn voice_audio_poll(state: State<'_, NativeAudioState>) -> Result<AudioPoll, String> {
    let started = Instant::now();
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    let session = current
        .as_mut()
        .ok_or_else(|| "Android audio is not open".to_string())?;
    let mut capture = [0_i16; CAPTURE_CHUNK_FRAMES];
    let read = unsafe {
        (session.api.read)(
            session.handle as *mut c_void,
            capture.as_mut_ptr(),
            CAPTURE_CHUNK_FRAMES as u32,
        ) as usize
    };
    let mono_16khz = session
        .decimator
        .process(&capture[..read.min(capture.len())]);
    let mut preview_due = false;
    let dictation_full = match session.dictation.as_mut() {
        Some(buffer) => {
            let full = buffer.push(&mono_16khz);
            let audio_ms = (buffer.len() as u64) * 1000 / dictation_rules::SAMPLE_RATE_HZ as u64;
            if audio_ms >= session.preview_due_ms {
                preview_due = true;
                session.preview_due_ms = next_due(session.preview_due_ms);
            }
            full
        }
        None => false,
    };
    let block_ms = (mono_16khz.len() as u64) * 1000 / dictation_rules::SAMPLE_RATE_HZ as u64;
    let reading = if session.dictation.is_some() {
        session.meter.push(&mono_16khz, block_ms)
    } else {
        super::mic_activity::Reading {
            level: 0.0,
            auto_stop: false,
        }
    };
    let vad_started = Instant::now();
    let probabilities = match session.vad.as_mut() {
        Some(vad) => match vad.probabilities(&mono_16khz) {
            Ok(frames) => frames,
            Err(error) => {
                log::warn!("[voice] Silero VAD failed; using RMS fallback: {error}");
                session.vad = None;
                Vec::new()
            }
        },
        None => Vec::new(),
    };
    let vad_elapsed = vad_started.elapsed();
    let turn_started = Instant::now();
    let mut turn_gate = session
        .smart_turn
        .as_mut()
        .map(|turn| move |window: &[i16]| turn.predict(window));
    let (speaking, utterance_id) = if session.vad.is_some() && probabilities.is_empty() {
        (session.segmenter.speech_active, None)
    } else if session.vad.is_none() {
        session
            .segmenter
            .accept_gated(&mono_16khz, None, turn_gate.as_mut())
    } else {
        let mut emitted = None;
        for (frame, probability) in probabilities {
            let (_, utterance) =
                session
                    .segmenter
                    .accept_gated(&frame, Some(probability), turn_gate.as_mut());
            emitted = emitted.or(utterance);
        }
        (session.segmenter.speech_active, emitted)
    };
    let mut stats = NativeStats::default();
    unsafe { (session.api.get_stats)(session.handle as *mut c_void, &mut stats) };
    drain_trace(session);
    if let Some(trace) = &session.trace {
        trace.metric("poll-total-us", started.elapsed().as_micros() as u64);
        trace.metric("vad-us", vad_elapsed.as_micros() as u64);
        trace.metric(
            "turn-gate-and-drain-us",
            turn_started.elapsed().as_micros() as u64,
        );
        trace.metric("vad-speaking", u64::from(speaking));
        trace.metric("capture-overflows", u64::from(stats.capture_overflows));
        trace.metric(
            "playback-empty-samples-including-idle",
            u64::from(stats.playback_empty_samples),
        );
    }
    if stats.last_error != 0 {
        return Err(format!("Oboe audio stream failed ({})", stats.last_error));
    }
    Ok(AudioPoll {
        speaking,
        dictation_full,
        preview_due,
        level: reading.level,
        auto_stop: reading.auto_stop,
        utterance_id: utterance_id.map(|id| id.to_string()),
        audio_clock_ms: audio_clock_ms(&stats),
        sample_rate: stats.sample_rate,
        frames_per_burst: stats.frames_per_burst,
        xrun_count: stats.xrun_count,
        last_error: stats.last_error,
        capture_overflows: stats.capture_overflows,
        playback_overflows: stats.playback_overflows,
        playback_empty_samples: stats.playback_empty_samples,
        vad_provider: if session.vad.is_some() {
            "silero-v6.2.2"
        } else {
            "rms-fallback"
        },
        vad_fallback: session.segmenter.vad_fallback || session.vad.is_none(),
        turn_detector: if session.smart_turn.is_some() {
            "smart-turn-v3.2"
        } else {
            "deterministic"
        },
        turn_detector_fallback: session.segmenter.gate_fallback || session.smart_turn.is_none(),
        turn_gate_evaluations: session.segmenter.gate_evaluations,
        turn_gate_vetoes: session.segmenter.gate_vetoes,
        turn_gate_forced: session.segmenter.gate_forced,
    })
}

fn audio_clock_ms(stats: &NativeStats) -> u64 {
    u64::try_from(stats.audio_clock_frames.max(0))
        .unwrap_or(0)
        .saturating_mul(1_000)
        / u64::try_from(stats.sample_rate.max(1)).unwrap_or(1)
}

#[tauri::command]
pub fn voice_audio_write_pcm(
    state: State<'_, NativeAudioState>,
    samples: Vec<i16>,
) -> Result<usize, String> {
    let started = Instant::now();
    let current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    let waited = started.elapsed();
    let session = current
        .as_ref()
        .ok_or_else(|| "Android audio is not open".to_string())?;
    let accepted = unsafe {
        (session.api.write)(
            session.handle as *mut c_void,
            samples.as_ptr(),
            u32::try_from(samples.len()).map_err(|_| "PCM buffer is too large")?,
        )
    };
    if accepted as usize > samples.len() {
        return Err("Invalid native playback sample count".into());
    }
    if let Some(trace) = &session.trace {
        // Keep recorder enqueue ordered with native writes. This is only a
        // bounded try_send; the worker owns all filesystem operations.
        trace.metric("write-lock-wait-us", waited.as_micros() as u64);
        trace.samples(Stage::Accepted, &samples[..accepted as usize]);
    }
    Ok(accepted as usize)
}

pub async fn transcribe_utterance(
    app: AppHandle,
    state: State<'_, NativeAudioState>,
    utterance_id: String,
) -> Result<String, String> {
    let samples = take_utterance_by_id(state, utterance_id)?;
    crate::speech::stt_transcribe_pcm16k(app, samples).await
}

fn take_utterance_by_id(
    state: State<'_, NativeAudioState>,
    utterance_id: String,
) -> Result<Vec<i16>, String> {
    let id = utterance_id
        .parse::<u64>()
        .map_err(|_| "Invalid native audio utterance ID".to_string())?;
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    let session = current
        .as_mut()
        .ok_or_else(|| "Android audio is not open".to_string())?;
    take_utterance(session, id)
}

fn take_utterance(session: &mut NativeSession, id: u64) -> Result<Vec<i16>, String> {
    session
        .segmenter
        .pending
        .remove(&id)
        .ok_or_else(|| "Native audio utterance has expired".to_string())
}

#[tauri::command]
pub async fn voice_audio_transcribe_utterance(
    app: AppHandle,
    state: State<'_, NativeAudioState>,
    utterance_id: String,
) -> Result<String, String> {
    transcribe_utterance(app, state, utterance_id).await
}

/// Starts recording the microphone for on-device dictation, opening the audio session when Live has not.
#[tauri::command]
pub fn voice_audio_dictation_start(
    app: AppHandle,
    state: State<'_, NativeAudioState>,
) -> Result<(), String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    match dictation_rules::start_dictation(current.as_ref().map(|session| session.owner)) {
        Entry::Attach => {
            if let Some(session) = current.as_mut() {
                session.dictation.get_or_insert_with(DictationBuffer::new);
            }
        }
        Entry::Refuse(message) => {
            log::warn!("[voice] dictation refused: {message}");
            return Err(message.to_string());
        }
        Entry::Open(owner) => {
            let mut session = open_session(&app, owner).inspect_err(|error| {
                log::warn!("[voice] dictation session open failed: {error}")
            })?;
            session.dictation = Some(DictationBuffer::new());
            *current = Some(session);
        }
    }
    if let Some(session) = current.as_mut() {
        session.preview_due_ms = next_due(0);
        session.meter = Meter::new();
    }
    Ok(())
}

/// Ends the dictation and transcribes it with the local Parakeet engine on the
/// CPU. Long input is decoded by segment, so a single decode stays bounded.
#[tauri::command]
pub async fn voice_audio_dictation_finish(
    app: AppHandle,
    state: State<'_, NativeAudioState>,
) -> Result<String, String> {
    let buffer = take_dictation(&state)?;
    if buffer.is_too_short() {
        return Ok(String::new());
    }
    let mut text = String::new();
    for segment in stream_chunker::split(&buffer.into_samples()) {
        let chunk = segment.samples[segment.overlap..].to_vec();
        if chunk.len() < dictation_rules::MIN_DICTATION_SAMPLES {
            continue;
        }
        let part = crate::speech::stt_transcribe_pcm16k(app.clone(), chunk).await?;
        text = merge(&text, &part, SEAM_WORDS);
    }
    Ok(text)
}

/// Decodes the most recent audio of the running dictation without consuming it,
/// so the composer can show text while the user is still speaking.
#[tauri::command]
pub async fn voice_audio_preview(
    app: AppHandle,
    state: State<'_, NativeAudioState>,
) -> Result<String, String> {
    let window = {
        let current = state
            .0
            .lock()
            .map_err(|_| "Android audio state is poisoned")?;
        let session = current
            .as_ref()
            .ok_or_else(|| "Android audio is not open".to_string())?;
        let buffer = session
            .dictation
            .as_ref()
            .ok_or_else(|| "No dictation is recording".to_string())?;
        buffer.peek_tail(PREVIEW_WINDOW_MS as usize)
    };
    if window.len() < dictation_rules::MIN_DICTATION_SAMPLES {
        return Ok(String::new());
    }
    crate::speech::stt_transcribe_pcm16k(app, window).await
}

fn take_dictation(state: &State<'_, NativeAudioState>) -> Result<DictationBuffer, String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    let session = current
        .as_mut()
        .ok_or_else(|| "Android audio is not open".to_string())?;
    let owner = session.owner;
    let buffer = session
        .dictation
        .take()
        .ok_or_else(|| "No dictation is recording".to_string())?;
    if owner == Owner::Dictation {
        *current = None;
    }
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_clock_uses_native_stream_frame_position() {
        let stats = NativeStats {
            audio_clock_frames: 96_000,
            sample_rate: 48_000,
            ..NativeStats::default()
        };
        assert_eq!(audio_clock_ms(&stats), 2_000);
        assert_eq!(std::mem::size_of::<NativeStats>(), 40);
        assert_eq!(std::mem::size_of::<PlaybackTraceStats>(), 16);
    }
}
