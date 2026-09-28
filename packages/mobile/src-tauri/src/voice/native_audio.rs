// SPDX-License-Identifier: MIT
//! Android Oboe capture and playback bridge.

use std::ffi::c_void;
use std::sync::Mutex;

use super::capture_segmenter::*;
use libloading::Library;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

const CAPTURE_CHUNK_FRAMES: usize = 960;
const DOWNSAMPLE_FACTOR: usize = 3;

type Create = unsafe extern "C" fn() -> *mut c_void;
type Destroy = unsafe extern "C" fn(*mut c_void);
type Open = unsafe extern "C" fn(*mut c_void) -> i32;
type Close = unsafe extern "C" fn(*mut c_void);
type Read = unsafe extern "C" fn(*mut c_void, *mut i16, u32) -> u32;
type Write = unsafe extern "C" fn(*mut c_void, *const i16, u32) -> u32;
type GetStats = unsafe extern "C" fn(*mut c_void, *mut NativeStats);

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
            Ok(Self {
                _library: library,
                create,
                destroy,
                open,
                close,
                read,
                write,
                get_stats,
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
}

impl Drop for NativeSession {
    fn drop(&mut self) {
        // SAFETY: handle was created by this API and is destroyed once here.
        unsafe { (self.api.destroy)(self.handle as *mut c_void) };
    }
}

#[derive(Default)]
pub struct NativeAudioState(Mutex<Option<NativeSession>>);

#[derive(Serialize)]
pub struct AudioPoll {
    speaking: bool,
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
    if current.is_some() {
        return Ok(());
    }
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
    *current = Some(NativeSession {
        api,
        handle: handle as usize,
        segmenter: CaptureSegmenter::new(),
        vad,
        smart_turn,
    });
    Ok(())
}

#[tauri::command]
pub fn voice_audio_close(state: State<'_, NativeAudioState>) -> Result<(), String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
    if let Some(session) = current.take() {
        // SAFETY: The handle remains owned by the session until it is dropped.
        unsafe { (session.api.close)(session.handle as *mut c_void) };
        drop(session);
    }
    Ok(())
}

#[tauri::command]
pub fn voice_audio_poll(state: State<'_, NativeAudioState>) -> Result<AudioPoll, String> {
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
    let mono_16khz = downsample_48khz_to_16khz(&capture[..read.min(capture.len())]);
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
    if stats.last_error != 0 {
        return Err(format!("Oboe audio stream failed ({})", stats.last_error));
    }
    Ok(AudioPoll {
        speaking,
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
    let current = state
        .0
        .lock()
        .map_err(|_| "Android audio state is poisoned")?;
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
    Ok(accepted as usize)
}

fn downsample_48khz_to_16khz(input: &[i16]) -> Vec<i16> {
    input
        .chunks_exact(DOWNSAMPLE_FACTOR)
        .map(|frame| {
            let average = frame.iter().map(|sample| i32::from(*sample)).sum::<i32>()
                / DOWNSAMPLE_FACTOR as i32;
            average as i16
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downsamples_complete_frames_and_drops_partial_tail() {
        assert_eq!(downsample_48khz_to_16khz(&[3, 6, 9, 10]), vec![6]);
    }

    #[test]
    fn audio_clock_uses_native_stream_frame_position() {
        let stats = NativeStats {
            audio_clock_frames: 96_000,
            sample_rate: 48_000,
            ..NativeStats::default()
        };
        assert_eq!(audio_clock_ms(&stats), 2_000);
        assert_eq!(std::mem::size_of::<NativeStats>(), 40);
    }
}
