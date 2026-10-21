// SPDX-License-Identifier: MIT
//! G5 evaluation harness: Parakeet TDT batch (final-STT incumbent) baseline WER
//! on the English corpus fixtures. Model dir expected to hold `nemo128.onnx`,
//! `encoder-model.int8.onnx`, `decoder_joint-model.int8.onnx`, `vocab.txt`.
//!
//! Run manually:
//!
//! ```text
//! cargo test --lib parakeet::baseline_tests::en_wer_baseline -- --ignored --nocapture
//! ```
//!
//! Optional env: `UNIFIA_PARAKEET_MODEL_DIR`, `G5_PARAKEET_OUT`.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::ParakeetEngine;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root resolves")
}

fn normalize_words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

fn word_error_rate(reference: &str, hypothesis: &str) -> f64 {
    let r = normalize_words(reference);
    let h = normalize_words(hypothesis);
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    for (i, rw) in r.iter().enumerate() {
        let mut cur = vec![i + 1];
        for (j, hw) in h.iter().enumerate() {
            let substitution = prev[j] + usize::from(rw != hw);
            let deletion = prev[j + 1] + 1;
            let insertion = cur[j] + 1;
            cur.push(substitution.min(deletion).min(insertion));
        }
        prev = cur;
    }
    prev[h.len()] as f64 / r.len() as f64
}

#[test]
#[ignore = "G5 baseline harness: needs the pinned Parakeet model dir; run manually"]
fn en_wer_baseline() {
    let root = repo_root();
    let model_dir = std::env::var("UNIFIA_PARAKEET_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join(".build-temp").join("livekit-model-download"));
    let corpus_path = root
        .join("packages")
        .join("contracts")
        .join("corpus")
        .join("unifia-eot-bench.json");
    let out_path = std::env::var("G5_PARAKEET_OUT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            root.join(".build-temp")
                .join("g5-streaming")
                .join("results")
                .join("parakeet-en.json")
        });

    let corpus_text = std::fs::read_to_string(&corpus_path).expect("read corpus");
    let corpus: Value = serde_json::from_str(&corpus_text).expect("parse corpus");
    let corpus_dir = corpus_path.parent().expect("corpus dir");

    let mut engine = ParakeetEngine::new();
    engine.load(&model_dir).expect("load pinned parakeet model");

    let mut results: Vec<Value> = Vec::new();
    for fixture in corpus["fixtures"].as_array().expect("fixtures array") {
        if fixture["language"].as_str() != Some("en") {
            continue;
        }
        let id = fixture["id"].as_str().expect("id").to_owned();
        let expected = fixture["transcript"]
            .as_str()
            .expect("transcript")
            .to_owned();
        let wav_rel = fixture["audio"]["path"].as_str().expect("audio path");
        let wav_path = corpus_dir.join(wav_rel);

        let mut reader = hound::WavReader::open(&wav_path).expect("open wav");
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 16_000, "{id}: expected 16 kHz");
        assert_eq!(spec.channels, 1, "{id}: expected mono");
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Int => reader
                .samples::<i16>()
                .map(|s| f32::from(s.expect("sample")) / 32768.0)
                .collect(),
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .map(|s| s.expect("sample"))
                .collect(),
        };

        let final_text = engine.transcribe(&samples).expect("transcribe");
        let value = word_error_rate(&expected, &final_text);
        eprintln!("[{id}] wer={value:.4} final={final_text:?}");
        results.push(json!({
            "id": id,
            "language": "en",
            "transcriptExpected": expected,
            "transcriptFinal": final_text,
            "wer": value,
            "audioValid": Value::Null,
        }));
    }

    let wer_sum: f64 = results.iter().filter_map(|r| r["wer"].as_f64()).sum();
    let report = json!({
        "harness": "parakeet_en_wer_baseline",
        "model": "parakeet-tdt-0.6b-v3-int8 (batch/final-STT incumbent, EN only)",
        "transport": "ParakeetEngine::transcribe(&[f32]) offline batch",
        "overall": {
            "fixtures": results.len(),
            "werMean": if results.is_empty() { 0.0 } else { wer_sum / results.len() as f64 },
        },
        "fixtures": results,
    });

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).expect("create results dir");
    }
    std::fs::write(
        &out_path,
        serde_json::to_string_pretty(&report).expect("serialize report"),
    )
    .expect("write report");
    eprintln!("wrote {}", out_path.display());
}
