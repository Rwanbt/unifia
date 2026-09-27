// SPDX-License-Identifier: MIT
//! Streaming Silero VAD v6.2.2 adapter for the Android 16 kHz capture path.

use ndarray::{ArrayD, IxDyn};
use ort::{
    ep::CPU,
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const MODEL_BYTES: &[u8] = include_bytes!("../../resources/silero_vad.onnx");
const MODEL_ID: &str = "silero-vad-v6.2.2-onnx";
const MODEL_REGISTRY: &str =
    include_str!("../../../../../packages/voice-host/models/registry.json");
const FRAME_SAMPLES: usize = 512;
const CONTEXT_SAMPLES: usize = 64;
const STATE_VALUES: usize = 2 * 128;
const SAMPLE_RATE: i64 = 16_000;

pub struct SileroVad {
    session: Session,
    context: [f32; CONTEXT_SAMPLES],
    state: Vec<f32>,
    pending: Vec<i16>,
}

impl SileroVad {
    pub fn load(data_dir: &Path) -> Result<Self, String> {
        let model_path = install_model(data_dir)?;
        let session = Session::builder()
            .map_err(|error| format!("create Silero ONNX session: {error}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|error| format!("configure Silero ONNX optimization: {error}"))?
            .with_intra_threads(1)
            .map_err(|error| format!("configure Silero ONNX threads: {error}"))?
            .with_execution_providers([CPU::default().build()])
            .map_err(|error| format!("configure Silero CPU execution: {error}"))?
            .commit_from_file(&model_path)
            .map_err(|error| format!("load pinned Silero model: {error}"))?;
        Ok(Self {
            session,
            context: [0.0; CONTEXT_SAMPLES],
            state: vec![0.0; STATE_VALUES],
            pending: Vec::with_capacity(FRAME_SAMPLES * 2),
        })
    }

    /// Returns one speech probability for every complete 512-sample frame.
    pub fn probabilities(&mut self, samples: &[i16]) -> Result<Vec<(Vec<i16>, f32)>, String> {
        self.pending.extend_from_slice(samples);
        let mut results = Vec::new();
        while self.pending.len() >= FRAME_SAMPLES {
            let frame = self.pending.drain(..FRAME_SAMPLES).collect::<Vec<_>>();
            let mut input = Vec::with_capacity(CONTEXT_SAMPLES + FRAME_SAMPLES);
            input.extend_from_slice(&self.context);
            input.extend(frame.iter().map(|sample| *sample as f32 / 32_768.0));
            let input = ArrayD::from_shape_vec(IxDyn(&[1, input.len()]), input)
                .map_err(|error| format!("shape Silero audio input: {error}"))?;
            let state = ArrayD::from_shape_vec(IxDyn(&[2, 1, 128]), self.state.clone())
                .map_err(|error| format!("shape Silero recurrent state: {error}"))?;
            let sample_rate = ArrayD::from_shape_vec(IxDyn(&[]), vec![SAMPLE_RATE])
                .map_err(|error| format!("shape Silero sample rate: {error}"))?;
            let outputs = self.session.run(ort::inputs![
                "input" => TensorRef::from_array_view(input.view()).map_err(|error| error.to_string())?,
                "state" => TensorRef::from_array_view(state.view()).map_err(|error| error.to_string())?,
                "sr" => TensorRef::from_array_view(sample_rate.view()).map_err(|error| error.to_string())?,
            ]).map_err(|error| format!("run Silero inference: {error}"))?;
            let probability = outputs["output"]
                .try_extract_array::<f32>()
                .map_err(|error| format!("read Silero probability: {error}"))?
                .iter()
                .next()
                .copied()
                .ok_or("Silero returned no probability")?;
            if !probability.is_finite() || !(0.0..=1.0).contains(&probability) {
                return Err("Silero returned a probability outside 0..=1".into());
            }
            let next_state = outputs["stateN"]
                .try_extract_array::<f32>()
                .map_err(|error| format!("read Silero recurrent state: {error}"))?;
            if next_state.len() != STATE_VALUES {
                return Err("Silero returned an unexpected recurrent-state shape".into());
            }
            self.state.copy_from_slice(
                next_state
                    .as_slice()
                    .ok_or("Silero state is not contiguous")?,
            );
            self.context.copy_from_slice(
                &input.as_slice().ok_or("Silero input is not contiguous")?
                    [input.len() - CONTEXT_SAMPLES..],
            );
            results.push((frame, probability));
        }
        Ok(results)
    }
}

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
        .ok_or("Silero VAD is missing from the model registry")?;
    let actual = hex::encode(Sha256::digest(MODEL_BYTES));
    if actual != expected_sha256 {
        return Err("Bundled Silero model does not match its pinned SHA-256".into());
    }
    fs::create_dir_all(data_dir)
        .map_err(|error| format!("create Voice model directory: {error}"))?;
    let model_path = data_dir.join("silero-vad-v6.2.2.onnx");
    let valid_existing = fs::symlink_metadata(&model_path)
        .is_ok_and(|metadata| metadata.file_type().is_file())
        && fs::read(&model_path)
            .is_ok_and(|bytes| hex::encode(Sha256::digest(bytes)) == expected_sha256);
    if valid_existing {
        return Ok(model_path);
    }
    let temporary = data_dir.join(".silero-vad-v6.2.2.onnx.part");
    let mut staged_file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)
        .map_err(|error| format!("create staged Silero model: {error}"))?;
    staged_file
        .write_all(MODEL_BYTES)
        .and_then(|()| staged_file.sync_all())
        .map_err(|error| format!("persist staged Silero model: {error}"))?;
    drop(staged_file);
    let written =
        fs::read(&temporary).map_err(|error| format!("verify staged Silero model: {error}"))?;
    if hex::encode(Sha256::digest(written)) != expected_sha256 {
        let _ = fs::remove_file(&temporary);
        return Err("Staged Silero model failed SHA-256 verification".into());
    }
    if model_path.exists() {
        fs::remove_file(&model_path)
            .map_err(|error| format!("replace invalid Silero model: {error}"))?;
    }
    fs::rename(&temporary, &model_path)
        .map_err(|error| format!("promote verified Silero model: {error}"))?;
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
    }
}
