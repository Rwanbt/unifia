// SPDX-License-Identifier: MIT
//! Smart Turn v3.2 turn-endpoint classifier (campaign section 19, G4).
//!
//! Replicates the pinned pipecat-ai `smart-turn-v3.2-cpu.onnx` inference
//! path inside the Android/host Rust runtime: an 8 s, 16 kHz mono segment
//! (int16, last 8 s kept and padded at the front) is converted to the
//! vendor Whisper log-mel features (`do_normalize=True`, periodic Hann,
//! Slaney mel) and run through the bundled CPU session. The result is the
//! accept/reject probability used by the deterministic trailing-silence
//! gate in `native_audio::CaptureSegmenter` (policy C of the G4 bake-off:
//! one evaluation per trigger, bounded 128 ms deterministic fallback on
//! veto — see `docs/operations/eot-bakeoff-smart-turn-2026-09-27.md`).
//!
//! Feature port source (BSD 2-Clause, vendored in the G4 bake-off harness
//! `scripts/voice/eot_bakeoff_smart_turn.py`, itself a transcription of
//! `pipecat/src/pipecat/audio/turn/smart_turn/_whisper_features.py`).

use ndarray::{ArrayD, IxDyn};
use ort::{
    ep::CPU,
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

const MODEL_BYTES: &[u8] = include_bytes!("../../resources/smart-turn-v3.2-cpu.onnx");
const MODEL_ID: &str = "smart-turn-v3.2-cpu-onnx";
const MODEL_REGISTRY: &str =
    include_str!("../../../../../packages/voice-host/models/registry.json");

/// Model input contract (registry `compatibility.input`): exactly 8 s at 16 kHz.
const SAMPLE_RATE: usize = 16_000;
const SEGMENT_SAMPLES: usize = SAMPLE_RATE * 8;
/// Accept strictly above 0.5, matching the pinned bake-off (`> threshold`).
pub const SMART_TURN_THRESHOLD: f32 = 0.5;

const N_FFT: usize = 400;
const HOP_LENGTH: usize = 160;
const N_MELS: usize = 80;
const FREQ_BINS: usize = N_FFT / 2 + 1;
/// Reflect-padded `SEGMENT_SAMPLES + N_FFT` signal, `N_FFT` window, hop
/// `HOP_LENGTH`: `floor((128400 - 400) / 160) + 1 = 801` windows, whose
/// final column the vendor reference drops.
const SPECTROGRAM_FRAMES: usize = SEGMENT_SAMPLES / HOP_LENGTH + 1;
const TIME_FRAMES: usize = SPECTROGRAM_FRAMES - 1;
const PAD: usize = N_FFT / 2;
const MEL_FLOOR: f64 = 1e-10;
const NORM_VARIANCE_EPS: f64 = 1e-7;

pub struct SmartTurn {
    session: Session,
    frontend: WhisperLogMel,
}

/// Vendor Whisper log-mel frontend (features only, no session state).
struct WhisperLogMel {
    fft: Arc<dyn Fft<f64>>,
    hann: Vec<f64>,
    /// Row-major `[FREQ_BINS][N_MELS]`, the transposed filterbank
    /// `mel_filters` of the Python reference (`_build_mel_filterbank`).
    mel_filters: Vec<f64>,
}

impl SmartTurn {
    /// Verifies the bundled artifact against the shared model registry and
    /// commits an ONNX Runtime CPU session configured exactly like the
    /// pinned bake-off (sequential, 1 intra-op thread, all graph
    /// optimizations, CPU execution provider only — no GPU by default).
    pub fn load(data_dir: &Path) -> Result<Self, String> {
        let model_path = install_model(data_dir)?;
        crate::onnx_runtime::ensure_compatible_runtime()?;
        let session = Session::builder()
            .map_err(|error| format!("create Smart Turn ONNX session: {error}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|error| format!("configure Smart Turn ONNX optimization: {error}"))?
            .with_intra_threads(1)
            .map_err(|error| format!("configure Smart Turn ONNX threads: {error}"))?
            .with_execution_providers([CPU::default().build()])
            .map_err(|error| format!("configure Smart Turn CPU execution: {error}"))?
            .commit_from_file(&model_path)
            .map_err(|error| format!("load pinned Smart Turn model: {error}"))?;
        Ok(Self {
            session,
            frontend: WhisperLogMel::new(),
        })
    }

    /// Runs one endpoint classification over a mono int16 segment and
    /// returns `(accept, probability)`.
    ///
    /// Mirrors the vendor Python pipeline (`compute_whisper_log_mel_features`,
    /// `do_normalize=True`): samples become `float32`, the segment keeps its
    /// latest 8 s and is zero-padded at the front, and mean/variance
    /// normalization runs in **float32** with numpy's exact pairwise
    /// reduction before the float64 spectrogram. Neither the dtype nor the
    /// reduction order is cosmetic: the int8 model amplifies ~5e-6 feature
    /// drift into probability shifts up to 0.05, which breaks cross-runtime
    /// parity.
    pub fn predict(&mut self, segment: &[i16]) -> Result<(bool, f32), String> {
        let mut audio = pad_segment_f32(segment);
        normalize_segment_f32(&mut audio);
        let audio: Vec<f64> = audio.iter().map(|value| *value as f64).collect();

        let features = self.frontend.features(&audio)?;
        #[cfg(test)]
        {
            let pcm_bytes = segment
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect::<Vec<_>>();
            let feature_bytes = features
                .iter()
                .flat_map(|feature| feature.to_le_bytes())
                .collect::<Vec<_>>();
            eprintln!(
                "SMART_TURN_FEATURES pcm_sha256={} feature_sha256={}",
                hex::encode(Sha256::digest(pcm_bytes)),
                hex::encode(Sha256::digest(feature_bytes)),
            );
        }
        let input = ArrayD::from_shape_vec(IxDyn(&[1, N_MELS, TIME_FRAMES]), features)
            .map_err(|error| format!("shape Smart Turn input: {error}"))?;
        let outputs = self
            .session
            .run(ort::inputs![
                "input_features" =>
                    TensorRef::from_array_view(input.view())
                        .map_err(|error| error.to_string())?,
            ])
            .map_err(|error| format!("run Smart Turn inference: {error}"))?;
        let probability = outputs["logits"]
            .try_extract_array::<f32>()
            .map_err(|error| format!("read Smart Turn probability: {error}"))?
            .iter()
            .next()
            .copied()
            .ok_or("Smart Turn returned no probability")?;
        if !probability.is_finite() || !(0.0..=1.0).contains(&probability) {
            return Err("Smart Turn returned a probability outside 0..=1".into());
        }
        Ok((probability > SMART_TURN_THRESHOLD, probability))
    }
}

/// Sums `values` with the float32 reduction numpy performs for
/// `np.add.reduce` / `np.sum` / `np.mean` / `np.var`
/// (`FLOAT_pairwise_sum`, `PW_BLOCKSIZE = 128`, splits aligned to the
/// eight-lane unroll — `loops_utils.h.src` of numpy 2.x). The parity gate
/// compares against that exact reduction: a plain sequential sum drifts by
/// ~1e-5 relative over 128 000 samples, which the int8 model amplifies past
/// the ±0.01 probability tolerance. Verified bit-identical to numpy 2.5.3
/// `mean`/`var`/`sqrt(var + 1e-7)` on the G4 fixture windows.
fn numpy_pairwise_sum_f32(values: &[f32]) -> f32 {
    let len = values.len();
    if len < 8 {
        let mut sum = -0.0_f32;
        for &value in values {
            sum += value;
        }
        return sum;
    }
    if len <= 128 {
        let mut lanes = [0.0_f32; 8];
        lanes.copy_from_slice(&values[..8]);
        let limit = len - (len % 8);
        let mut index = 8;
        while index < limit {
            for lane in 0..8 {
                lanes[lane] += values[index + lane];
            }
            index += 8;
        }
        let mut sum = ((lanes[0] + lanes[1]) + (lanes[2] + lanes[3]))
            + ((lanes[4] + lanes[5]) + (lanes[6] + lanes[7]));
        while index < len {
            sum += values[index];
            index += 1;
        }
        return sum;
    }
    let half = len / 2 - (len / 2) % 8;
    numpy_pairwise_sum_f32(&values[..half]) + numpy_pairwise_sum_f32(&values[half..])
}

/// Converts a mono int16 segment into the vendor float32 input: samples
/// scale by `1/32768`, anything past the latest 8 s is dropped, shorter
/// input is zero-padded at the front — the caller behaviour of pipecat's
/// `LocalSmartTurnAnalyzerV3.truncate_audio_to_last_n_seconds`.
fn pad_segment_f32(segment: &[i16]) -> Vec<f32> {
    let mut audio: Vec<f32> = segment
        .iter()
        .map(|sample| *sample as f32 / 32_768.0)
        .collect();
    if audio.len() > SEGMENT_SAMPLES {
        audio.drain(..audio.len() - SEGMENT_SAMPLES);
    } else if audio.len() < SEGMENT_SAMPLES {
        let missing = SEGMENT_SAMPLES - audio.len();
        let mut padded = vec![0.0_f32; SEGMENT_SAMPLES];
        padded[missing..].copy_from_slice(&audio);
        audio = padded;
    }
    audio
}

/// The vendor `(x - x.mean()) / sqrt(x.var() + 1e-7)` step over the
/// float32 buffer, using [`numpy_pairwise_sum_f32`] so mean, variance and
/// scale are bit-identical to the numpy reference. Returns
/// `(mean, variance, scale)` for diagnostics.
fn normalize_segment_f32(audio: &mut [f32]) -> (f32, f32, f32) {
    let count = audio.len() as f32;
    let mean = numpy_pairwise_sum_f32(audio) / count;
    let mut squared = Vec::with_capacity(audio.len());
    for value in audio.iter() {
        squared.push((value - mean) * (value - mean));
    }
    let variance = numpy_pairwise_sum_f32(&squared) / count;
    let scale = (variance + NORM_VARIANCE_EPS as f32).sqrt();
    for value in audio {
        *value = (*value - mean) / scale;
    }
    (mean, variance, scale)
}

impl WhisperLogMel {
    fn new() -> Self {
        let mut planner = FftPlanner::<f64>::new();
        Self {
            fft: planner.plan_fft_forward(N_FFT),
            hann: (0..N_FFT)
                .map(|n| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * n as f64 / N_FFT as f64).cos())
                .collect(),
            mel_filters: build_mel_filterbank(),
        }
    }

    /// Vendor Whisper log-mel features: reflect-pad to 128 400 samples,
    /// periodic Hann window, rfft power spectrogram, Slaney mel filterbank,
    /// `log10`, drop the last column, floor to `max - 8`, then `(x+4)/4`.
    fn features(&self, audio: &[f64]) -> Result<Vec<f32>, String> {
        debug_assert_eq!(audio.len(), SEGMENT_SAMPLES);
        let mut padded = vec![0.0_f64; SEGMENT_SAMPLES + N_FFT];
        for index in 0..PAD {
            padded[index] = audio[PAD - index];
            padded[PAD + SEGMENT_SAMPLES + index] = audio[SEGMENT_SAMPLES - 2 - index];
        }
        padded[PAD..PAD + SEGMENT_SAMPLES].copy_from_slice(audio);

        let frames = SPECTROGRAM_FRAMES;
        let mut magnitudes = vec![0.0_f64; FREQ_BINS * frames];
        let mut buffer: Vec<Complex<f64>> = vec![Complex::new(0.0, 0.0); N_FFT];
        for frame in 0..frames {
            let base = frame * HOP_LENGTH;
            for index in 0..N_FFT {
                buffer[index] = Complex::new(padded[base + index] * self.hann[index], 0.0);
            }
            self.fft.process(&mut buffer);
            for bin in 0..FREQ_BINS {
                magnitudes[bin * frames + frame] =
                    buffer[bin].re * buffer[bin].re + buffer[bin].im * buffer[bin].im;
            }
        }

        // mel_spec[m][frame] = max(floor, sum_k mel_filters[k][m] * power[k][frame])
        let mut log_spec = vec![0.0_f64; N_MELS * frames];
        for mel in 0..N_MELS {
            for frame in 0..frames {
                let mut accumulator = 0.0_f64;
                for bin in 0..FREQ_BINS {
                    accumulator +=
                        self.mel_filters[bin * N_MELS + mel] * magnitudes[bin * frames + frame];
                }
                log_spec[mel * frames + frame] = accumulator.max(MEL_FLOOR).log10();
            }
        }

        // Drop the final time column before dynamic-range compression.
        let kept_frames = frames - 1;
        let maximum = log_spec
            .iter()
            .take(N_MELS * kept_frames)
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);
        let floor = maximum - 8.0;
        let mut features = Vec::with_capacity(N_MELS * kept_frames);
        for mel in 0..N_MELS {
            for frame in 0..kept_frames {
                let value = log_spec[mel * frames + frame].max(floor);
                features.push(((value + 4.0) / 4.0) as f32);
            }
        }
        if features.iter().any(|value| !value.is_finite()) {
            return Err("Smart Turn log-mel features contain a non-finite value".into());
        }
        Ok(features)
    }
}

/// Slaney mel scale, replicating `_hertz_to_mel_slaney` /
/// `_mel_to_hertz_slaney` from the vendored reference.
fn hertz_to_mel_slaney(frequency: f64) -> f64 {
    const MIN_LOG_HERTZ: f64 = 1_000.0;
    const MIN_LOG_MEL: f64 = 15.0;
    let logstep = 27.0 / 6.4_f64.ln();
    if frequency >= MIN_LOG_HERTZ {
        MIN_LOG_MEL + (frequency / MIN_LOG_HERTZ).ln() * logstep
    } else {
        3.0 * frequency / 200.0
    }
}

fn mel_to_hertz_slaney(mel: f64) -> f64 {
    const MIN_LOG_MEL: f64 = 15.0;
    let logstep = 6.4_f64.ln() / 27.0;
    if mel >= MIN_LOG_MEL {
        1_000.0 * (logstep * (mel - MIN_LOG_MEL)).exp()
    } else {
        200.0 * mel / 3.0
    }
}

fn linspace(start: f64, end: f64, count: usize) -> Vec<f64> {
    if count == 1 {
        return vec![start];
    }
    let step = (end - start) / (count - 1) as f64;
    (0..count)
        .map(|index| start + step * index as f64)
        .collect()
}

/// Replicates `_build_mel_filterbank` of the vendored reference and
/// returns the `[FREQ_BINS][N_MELS]` row-major filterbank.
fn build_mel_filterbank() -> Vec<f64> {
    let mel_min = hertz_to_mel_slaney(0.0);
    let mel_max = hertz_to_mel_slaney(SAMPLE_RATE as f64 / 2.0);
    let filter_frequencies: Vec<f64> = linspace(mel_min, mel_max, N_MELS + 2)
        .into_iter()
        .map(mel_to_hertz_slaney)
        .collect();
    let fft_frequencies = linspace(0.0, SAMPLE_RATE as f64 / 2.0, FREQ_BINS);
    let filter_differences: Vec<f64> = filter_frequencies
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .collect();

    let mut filters = vec![0.0_f64; FREQ_BINS * N_MELS];
    for bin in 0..FREQ_BINS {
        for mel in 0..N_MELS {
            let slope = filter_frequencies[mel] - fft_frequencies[bin];
            let down = -slope / filter_differences[mel];
            let up =
                (filter_frequencies[mel + 2] - fft_frequencies[bin]) / filter_differences[mel + 1];
            let triangle = down.min(up).max(0.0);
            let enorm = 2.0 / (filter_frequencies[mel + 2] - filter_frequencies[mel]);
            filters[bin * N_MELS + mel] = triangle * enorm;
        }
    }
    filters
}

/// Mirrors `vad::install_model` for the Smart Turn artifact: verify the
/// embedded bytes against the registry pin, stage, verify, then promote.
fn install_model(data_dir: &Path) -> Result<PathBuf, String> {
    let expected_sha256 = serde_json::from_str::<serde_json::Value>(MODEL_REGISTRY)
        .ok()
        .and_then(|registry| registry["models"].as_array().cloned())
        .and_then(|models| {
            models
                .into_iter()
                .find(|model| model["model_id"] == MODEL_ID)
        })
        .and_then(|model| model["sha256"].as_str().map(str::to_owned))
        .ok_or("Smart Turn model is missing from the model registry")?;
    let actual = hex::encode(Sha256::digest(MODEL_BYTES));
    if actual != expected_sha256 {
        return Err("Bundled Smart Turn model does not match its pinned SHA-256".into());
    }
    fs::create_dir_all(data_dir)
        .map_err(|error| format!("create Voice model directory: {error}"))?;
    let model_path = data_dir.join("smart-turn-v3.2-cpu.onnx");
    let valid_existing = fs::symlink_metadata(&model_path)
        .is_ok_and(|metadata| metadata.file_type().is_file())
        && fs::read(&model_path)
            .is_ok_and(|bytes| hex::encode(Sha256::digest(bytes)) == expected_sha256);
    if valid_existing {
        return Ok(model_path);
    }
    let temporary = data_dir.join(".smart-turn-v3.2-cpu.onnx.part");
    let mut staged_file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)
        .map_err(|error| format!("create staged Smart Turn model: {error}"))?;
    staged_file
        .write_all(MODEL_BYTES)
        .and_then(|()| staged_file.sync_all())
        .map_err(|error| format!("persist staged Smart Turn model: {error}"))?;
    drop(staged_file);
    let written =
        fs::read(&temporary).map_err(|error| format!("verify staged Smart Turn model: {error}"))?;
    if hex::encode(Sha256::digest(written)) != expected_sha256 {
        let _ = fs::remove_file(&temporary);
        return Err("Staged Smart Turn model failed SHA-256 verification".into());
    }
    if model_path.exists() {
        fs::remove_file(&model_path)
            .map_err(|error| format!("replace invalid Smart Turn model: {error}"))?;
    }
    fs::rename(&temporary, &model_path)
        .map_err(|error| format!("promote verified Smart Turn model: {error}"))?;
    Ok(model_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_model_hash_matches_the_shared_registry() {
        let registry: serde_json::Value = serde_json::from_str(MODEL_REGISTRY).unwrap();
        let model = registry["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|model| model["model_id"] == MODEL_ID)
            .unwrap();
        assert_eq!(
            hex::encode(Sha256::digest(MODEL_BYTES)),
            model["sha256"].as_str().unwrap()
        );
        assert_eq!(
            MODEL_BYTES.len(),
            model["size_bytes"].as_u64().unwrap() as usize
        );
    }

    /// Digital silence collapses to the mel floor on every bin, so the
    /// whole feature map must be the exact constant `(log10(1e-10)+4)/4`.
    #[test]
    fn log_mel_features_of_digital_silence_are_the_floor_constant() {
        let frontend = WhisperLogMel::new();
        let features = frontend.features(&vec![0.0_f64; SEGMENT_SAMPLES]).unwrap();
        assert_eq!(features.len(), N_MELS * TIME_FRAMES);
        assert!(
            features.iter().all(|value| (*value - -1.5).abs() < 1e-6),
            "expected the exact floor constant -1.5, got min={} max={}",
            features.iter().cloned().fold(f32::INFINITY, f32::min),
            features.iter().cloned().fold(f32::NEG_INFINITY, f32::max),
        );
    }

    /// The full chain (feature port + pinned ORT session) on 8 s of digital
    /// silence must reproduce the Python reference probability
    /// (`scripts/voice/eot_bakeoff_smart_turn.py`, onnxruntime 1.28.0):
    /// 0.987037 — silence classifies as "turn ended".
    #[test]
    fn predict_reproduces_the_python_reference_probability_on_digital_silence() {
        let data_dir = std::env::temp_dir().join("unifia-smart-turn-unit");
        let mut detector = SmartTurn::load(&data_dir).expect("load pinned Smart Turn model");
        let (accept, probability) = detector
            .predict(&vec![0_i16; SEGMENT_SAMPLES])
            .expect("predict on digital silence");
        assert!(accept, "silence must classify as end-of-turn");
        assert!(
            (probability - 0.987_037).abs() <= 0.01,
            "probability {probability} does not match the Python reference 0.987037",
        );
    }
}
