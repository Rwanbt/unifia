// SPDX-License-Identifier: MIT
//! Executes the pinned Silero VAD and the deterministic capture segmenter
//! against every fixture of the five-language UNIFIA-EOT-BENCH corpus.
//!
//! Also runs the Smart Turn gated candidate (policy C) against the same
//! budgets plus decision-level parity with the exported bake-off fixture
//! `packages/voice-core/fixtures/smart-turn-gate.json`.

use super::capture_segmenter::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const CORPUS_JSON: &str = include_str!("../../../../contracts/corpus/unifia-eot-bench.json");
/// 512 samples at 16 kHz.
const FRAME_MS: u32 = 32;
const SPEECH_THRESHOLD: f32 = 0.5;
const EXPECTED_LANGUAGES: [&str; 5] = ["en", "fr", "es", "it", "de"];

#[derive(serde::Deserialize)]
struct Corpus {
    version: String,
    languages: Vec<String>,
    fixtures: Vec<CorpusFixture>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusFixture {
    id: String,
    language: String,
    scenario: String,
    expected_turn_complete: bool,
    audio: CorpusAudio,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusAudio {
    path: String,
    sample_rate_hz: u32,
    duration_ms: u32,
    sha256: String,
    speech_intervals_ms: Vec<Interval>,
    silence_intervals_ms: Vec<Interval>,
    forbidden_eot_intervals_ms: Vec<Interval>,
    expected_eot_ms: Option<u32>,
    assistant_speech_intervals_ms: Vec<Interval>,
    noise_condition: String,
    overlap_condition: String,
}

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct Interval {
    start_ms: u32,
    end_ms: u32,
}

struct Outcome {
    id: String,
    language: String,
    condition: String,
    speech_frames: usize,
    detected_speech_frames: usize,
    silence_frames: usize,
    false_positive_frames: usize,
    emissions_ms: Vec<u32>,
    expected_eot_ms: Option<u32>,
    forbidden_emissions: usize,
    /// Smart Turn decisions drained while replaying this fixture (policy C).
    gate_decisions: Vec<GateDecision>,
    /// `true` when a gate call errored and the deterministic commit fired.
    gate_fallback: bool,
}

/// Deterministic stand-in for the measured Smart Turn end-to-end latency of
/// the pinned bake-off (p95 37.21 ms -> 38 ms): an accepted gate pushes the
/// emission `GATE_E2E_DELAY_MS` past the frame end, exactly like the harness
/// `emission_ms = frame_end + ceil(e2e_ms)`. Machine-independent, in-range
/// with the live 30-75 ms measured on 2026-09-27.
const GATE_E2E_DELAY_MS: u32 = 38;

fn corpus_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contracts/corpus")
}

fn in_interval(ms: u32, intervals: &[Interval]) -> bool {
    intervals
        .iter()
        .any(|interval| ms >= interval.start_ms && ms < interval.end_ms)
}

/// Replicates Python's `round(numerator / denominator)` used by
/// `generate_eot_audio_fixtures.py`: round-half-to-even on an exact
/// rational (the fixture duration is `round(samples * 1000 / 16000)`).
fn python_round(numerator: u64, denominator: u64) -> u64 {
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;
    match remainder * 2 {
        half if half < denominator => quotient,
        half if half > denominator => quotient + 1,
        _ if quotient.is_multiple_of(2) => quotient,
        _ => quotient + 1,
    }
}

fn read_fixture_samples(fixture: &CorpusFixture) -> Result<Vec<i16>, String> {
    let wav_path = corpus_root().join(&fixture.audio.path);
    let bytes = std::fs::read(&wav_path)
        .map_err(|error| format!("read {}: {error}", fixture.audio.path))?;
    let digest = hex::encode(Sha256::digest(&bytes));
    if digest != fixture.audio.sha256 {
        return Err(format!("{}: WAV SHA-256 mismatch", fixture.id));
    }
    let reader = hound::WavReader::new(std::io::Cursor::new(bytes))
        .map_err(|error| format!("{}: open WAV: {error}", fixture.id))?;
    let spec = reader.spec();
    if spec.sample_rate != fixture.audio.sample_rate_hz
        || spec.sample_rate != 16_000
        || spec.channels != 1
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Err(format!("{}: unexpected WAV format {spec:?}", fixture.id));
    }
    let samples = reader
        .into_samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("{}: decode WAV: {error}", fixture.id))?;
    let measured_ms = python_round(samples.len() as u64 * 1_000, 16_000);
    if measured_ms != fixture.audio.duration_ms as u64 {
        return Err(format!(
            "{}: WAV duration {measured_ms} ms does not match annotation {} ms",
            fixture.id, fixture.audio.duration_ms
        ));
    }
    Ok(samples)
}

fn evaluate<F: FnMut(&[i16]) -> Result<(bool, f32), String> + ?Sized>(
    fixture: &CorpusFixture,
    model_dir: &Path,
    mut gate: Option<&mut F>,
) -> Result<Outcome, String> {
    let samples = read_fixture_samples(fixture)?;
    let mut vad = super::vad::SileroVad::load(model_dir)?;
    let mut segmenter = CaptureSegmenter::new();
    let mut outcome = Outcome {
        id: fixture.id.clone(),
        language: fixture.language.clone(),
        condition: format!(
            "{}/{}",
            fixture.audio.noise_condition, fixture.audio.overlap_condition
        ),
        speech_frames: 0,
        detected_speech_frames: 0,
        silence_frames: 0,
        false_positive_frames: 0,
        emissions_ms: Vec::new(),
        expected_eot_ms: fixture.audio.expected_eot_ms,
        forbidden_emissions: 0,
        gate_decisions: Vec::new(),
        gate_fallback: false,
    };
    let frames = vad.probabilities(&samples)?;
    for (index, (frame, probability)) in frames.iter().enumerate() {
        let center_ms = index as u32 * FRAME_MS + FRAME_MS / 2;
        let emission_ms = index as u32 * FRAME_MS + FRAME_MS;
        let detected = *probability >= SPEECH_THRESHOLD;
        if in_interval(center_ms, &fixture.audio.speech_intervals_ms) {
            outcome.speech_frames += 1;
            if detected {
                outcome.detected_speech_frames += 1;
            }
        } else if in_interval(center_ms, &fixture.audio.silence_intervals_ms)
            && !in_interval(center_ms, &fixture.audio.assistant_speech_intervals_ms)
        {
            outcome.silence_frames += 1;
            if detected {
                outcome.false_positive_frames += 1;
            }
        }
        let (_, utterance_id) =
            segmenter.accept_gated(frame, Some(*probability), gate.as_deref_mut());
        let decision = segmenter.last_gate.take();
        // An accepted evaluation pays the model's end-to-end latency (the
        // harness records `frame_end + ceil(e2e_ms)`); a forced cap commit,
        // a veto, a gate error and the ungated maximum-duration path all
        // commit at the frame end with no extra delay.
        let delay = match &decision {
            Some(decision) if decision.accepted && !decision.forced => GATE_E2E_DELAY_MS,
            _ => 0,
        };
        outcome.gate_fallback |= segmenter.gate_fallback;
        if let Some(decision) = decision {
            outcome.gate_decisions.push(decision);
        }
        if utterance_id.is_some() {
            let emission_ms = emission_ms + delay;
            outcome.emissions_ms.push(emission_ms);
            if in_interval(emission_ms, &fixture.audio.forbidden_eot_intervals_ms) {
                outcome.forbidden_emissions += 1;
            }
        }
    }
    Ok(outcome)
}

#[test]
fn corpus_audio_matches_its_json_annotations() {
    let corpus: Corpus = serde_json::from_str(CORPUS_JSON).expect("parse corpus JSON");
    assert_eq!(corpus.version, "2.0.0");
    assert_eq!(corpus.languages, EXPECTED_LANGUAGES);
    assert_eq!(corpus.fixtures.len(), 91);
    for fixture in &corpus.fixtures {
        let samples = read_fixture_samples(fixture).unwrap_or_else(|error| panic!("{error}"));
        assert!(!samples.is_empty(), "{}: empty audio", fixture.id);
        assert_eq!(
            fixture.audio.expected_eot_ms.is_some(),
            fixture.expected_turn_complete,
            "{}: expectedEotMs/expectedTurnComplete mismatch",
            fixture.id
        );
        assert!(
            !fixture.audio.forbidden_eot_intervals_ms.is_empty(),
            "{}: no forbidden EOT interval",
            fixture.id
        );
    }
}

#[test]
fn silero_pipeline_runs_the_five_language_eot_corpus() {
    let corpus: Corpus = serde_json::from_str(CORPUS_JSON).expect("parse corpus JSON");
    let model_dir = std::env::temp_dir().join("unifia-vad-eot-corpus");
    let mut errors = Vec::new();
    let mut outcomes = Vec::new();
    for fixture in &corpus.fixtures {
        match evaluate(
            fixture,
            &model_dir,
            None::<&mut fn(&[i16]) -> Result<(bool, f32), String>>,
        ) {
            Ok(outcome) => outcomes.push(outcome),
            Err(error) => errors.push(error),
        }
    }
    assert!(errors.is_empty(), "pipeline failures:\n{errors:#?}");
    assert_eq!(outcomes.len(), 91);

    let failures = budget_failures(&outcomes);
    assert!(
        failures.is_empty(),
        "G4 EOT benchmark violations ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Calibrated G4 budgets of `unifia-eot-bench` v2.0.0, shared by the
/// deterministic candidate A (`silero_pipeline_runs_the_five_language_eot_corpus`)
/// and the Smart Turn gated policy-C candidate
/// (`smart_turn_gated_corpus_meets_the_policy_c_budgets_and_parity`).
///
/// Measured anchor on the pinned Silero v6.2.2 + pinned corpus
/// (2026-09-27): speech rate 0.9503, false-positive rate 0.0769, 76/76
/// non-barge turn-complete finals within 178 ms, 24 forbidden emissions
/// total (14 early finals within 80 ms, 5 internal-pause, 5 incomplete
/// candidates), 0 on clipped and barge fixtures; 78/81 turn-complete
/// finals within 400 ms and 4/5 barge fixtures emitting (en-barge-01
/// produces no trailing silence before EOF while the assistant is still
/// speaking). Bounds are the campaign brief G4 budgets.
fn budget_failures(outcomes: &[Outcome]) -> Vec<String> {
    // Calibrated bounds. Measured on the pinned Silero v6.2.2 + pinned
    // corpus (2026-09-27): speech rate 0.9503, false-positive rate 0.0769,
    // 76/76 non-barge turn-complete finals within 178 ms, 24 forbidden
    // emissions total (14 early finals within 80 ms, 5 internal-pause, 5
    // incomplete candidates), 0 on clipped and barge fixtures.
    const SPEECH_RATE_MIN: f64 = 0.94;
    const FALSE_POSITIVE_RATE_MAX: f64 = 0.12;
    const FINAL_DELTA_MAX_MS: i64 = 250;
    const EARLY_FINAL_MAX_MS: i64 = 150;
    const TOTAL_FORBIDDEN_MAX: usize = 30;
    const MID_RECORDING_FORBIDDEN_MAX: usize = 6;
    const INCOMPLETE_FORBIDDEN_MAX: usize = 2;
    // Measured 78/81 turn-complete finals within 400 ms and 4/5 barge
    // fixtures emitting (en-barge-01 produces no trailing silence before
    // EOF while the assistant is still speaking).
    const TURN_COMPLETE_MATCHED_MIN: usize = 76;
    const BARGE_EMITTED_MIN: usize = 4;

    let mut failures: Vec<String> = Vec::new();
    let mut speech_frames = 0_usize;
    let mut detected_speech_frames = 0_usize;
    let mut silence_frames = 0_usize;
    let mut false_positive_frames = 0_usize;
    let mut turn_complete = 0_usize;
    let mut matched_400 = 0_usize;
    let mut total_forbidden = 0_usize;
    let mut early_finals = 0_usize;
    let mut mid_recording_forbidden = 0_usize;
    let mut barge_total = 0_usize;
    let mut barge_emitted = 0_usize;
    let mut language_matched: BTreeMap<&str, usize> = BTreeMap::new();
    let mut language_total: BTreeMap<&str, usize> = BTreeMap::new();

    for outcome in outcomes {
        speech_frames += outcome.speech_frames;
        detected_speech_frames += outcome.detected_speech_frames;
        silence_frames += outcome.silence_frames;
        false_positive_frames += outcome.false_positive_frames;
        total_forbidden += outcome.forbidden_emissions;

        let is_barge = outcome.condition.ends_with("/assistant-speech");
        let is_clipped = outcome.condition.starts_with("clipped/");
        let is_incomplete = outcome.expected_eot_ms.is_none();
        let last_emission = outcome.emissions_ms.last().copied();
        if is_barge {
            barge_total += 1;
            // en-barge-01 emits nothing: the assistant speech gates the
            // trailing-silence timer past EOF. Measured 4/5 on 2026-09-27.
            if last_emission.is_some() {
                barge_emitted += 1;
            }
        }
        let detail = match (outcome.expected_eot_ms, last_emission) {
            (Some(expected), Some(emitted)) => {
                let delta = emitted as i64 - expected as i64;
                format!("expected={expected} emitted={emitted} delta={delta:+}")
            }
            (Some(expected), None) => format!("expected={expected} emitted=NONE"),
            (None, Some(emitted)) => format!("expected=NONE emitted={emitted}"),
            (None, None) => "expected=NONE emitted=NONE".to_string(),
        };
        println!(
            "[{}] {} last-emission({}) forbidden={} emissions={:?}",
            outcome.id,
            outcome.condition,
            detail,
            outcome.forbidden_emissions,
            outcome.emissions_ms
        );

        match (outcome.expected_eot_ms, last_emission) {
            (Some(expected), Some(emitted)) => {
                turn_complete += 1;
                let delta = emitted as i64 - expected as i64;
                if delta.abs() <= 400 {
                    matched_400 += 1;
                }
                let last_forbidden = emitted < expected;
                let forbidden_before_last =
                    outcome.forbidden_emissions - usize::from(last_forbidden);
                mid_recording_forbidden += forbidden_before_last;
                if last_forbidden {
                    early_finals += 1;
                    if delta < -EARLY_FINAL_MAX_MS {
                        failures.push(format!(
                            "{}: final emission {delta:+} ms is earlier than \
                             -{EARLY_FINAL_MAX_MS} ms",
                            outcome.id
                        ));
                    }
                }
                if !is_barge {
                    if delta.abs() > FINAL_DELTA_MAX_MS {
                        failures.push(format!(
                            "{}: non-barge final emission delta {delta:+} ms \
                             exceeds Ãƒâ€šÃ‚Â±{FINAL_DELTA_MAX_MS} ms",
                            outcome.id
                        ));
                    }
                    *language_matched
                        .entry(outcome.language.as_str())
                        .or_default() += 1;
                }
            }
            (Some(_expected), None) => {
                turn_complete += 1;
                if !is_barge {
                    failures.push(format!(
                        "{}: no final emission for a turn-complete fixture",
                        outcome.id
                    ));
                }
            }
            (None, _) => {
                if is_clipped && last_emission.is_some() {
                    failures.push(format!(
                        "{}: clipped fixture must not emit without trailing silence",
                        outcome.id
                    ));
                }
                // Incomplete fixtures: the deterministic candidate keeps
                // emitting one utterance inside the forbidden window; the
                // turn engine (not this layer) must decline the commit.
                if is_incomplete && outcome.forbidden_emissions > INCOMPLETE_FORBIDDEN_MAX {
                    failures.push(format!(
                        "{}: {} forbidden emissions on an incomplete fixture \
                         (max {INCOMPLETE_FORBIDDEN_MAX})",
                        outcome.id, outcome.forbidden_emissions
                    ));
                }
                if !is_clipped && !is_incomplete {
                    failures.push(format!(
                        "{}: unexpected null-EOT fixture outside the \
                         incomplete/clipped scenarios",
                        outcome.id
                    ));
                }
            }
        }
        if is_barge && outcome.forbidden_emissions > 0 {
            failures.push(format!(
                "{}: barge fixture fired {} times inside its forbidden window",
                outcome.id, outcome.forbidden_emissions
            ));
        }
        if outcome.forbidden_emissions > 2 {
            failures.push(format!(
                "{}: {} forbidden emissions (max 2 per fixture)",
                outcome.id, outcome.forbidden_emissions
            ));
        }
        *language_total.entry(outcome.language.as_str()).or_default() += 1;
    }

    let speech_rate = detected_speech_frames as f64 / speech_frames.max(1) as f64;
    let false_positive_rate = false_positive_frames as f64 / silence_frames.max(1) as f64;
    println!(
        "frames: speech={speech_frames} detected={detected_speech_frames} \
         rate={speech_rate:.4} | silence={silence_frames} false-positive=\
         {false_positive_frames} rate={false_positive_rate:.4}"
    );
    println!(
        "turn-complete: {turn_complete}, final within 400 ms: {matched_400}, \
         early finals: {early_finals}, mid-recording forbidden: \
         {mid_recording_forbidden}, total forbidden: {total_forbidden}"
    );
    for (language, matched) in &language_matched {
        let total = language_total.get(language).copied().unwrap_or(0);
        println!("language {language}: {matched} matched non-barge finals / {total}");
    }
    println!(
        "barge fixtures: {barge_emitted}/{barge_total} produced a final emission \
         outside the forbidden window"
    );

    if speech_rate < SPEECH_RATE_MIN {
        failures.push(format!(
            "speech detection rate {speech_rate:.4} below {SPEECH_RATE_MIN:.2}"
        ));
    }
    if false_positive_rate > FALSE_POSITIVE_RATE_MAX {
        failures.push(format!(
            "silence false-positive rate {false_positive_rate:.4} above \
             {FALSE_POSITIVE_RATE_MAX:.2}"
        ));
    }
    if matched_400 < TURN_COMPLETE_MATCHED_MIN {
        failures.push(format!(
            "only {matched_400}/{turn_complete} turn-complete finals within \
             400 ms (min {TURN_COMPLETE_MATCHED_MIN})"
        ));
    }
    if total_forbidden > TOTAL_FORBIDDEN_MAX {
        failures.push(format!(
            "{total_forbidden} forbidden emissions exceed the calibrated \
             budget of {TOTAL_FORBIDDEN_MAX}"
        ));
    }
    if mid_recording_forbidden > MID_RECORDING_FORBIDDEN_MAX {
        failures.push(format!(
            "{mid_recording_forbidden} mid-recording forbidden emissions \
             exceed the calibrated budget of {MID_RECORDING_FORBIDDEN_MAX}"
        ));
    }
    if barge_emitted < BARGE_EMITTED_MIN {
        failures.push(format!(
            "only {barge_emitted}/{barge_total} barge fixtures emitted a final \
             (min {BARGE_EMITTED_MIN})"
        ));
    }
    for language in EXPECTED_LANGUAGES {
        let matched = language_matched.get(language).copied().unwrap_or(0);
        if matched == 0 {
            failures.push(format!(
                "language {language}: no non-barge turn-complete final matched"
            ));
        }
    }
    failures
}

/// Shared cross-runtime fixture consumed by the Rust replay below and by
/// `packages/app/src/voice/turn-endpointing-parity.test.ts`. Both runtimes
/// must reproduce `events` for every case's `frames` probability sequence
/// (G4 cross-runtime EOT parity, `turn-endpointing.ts` ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Â `CaptureSegmenter`).
const PARITY_FIXTURE: &str =
    include_str!("../../../../voice-core/fixtures/turn-endpointing-parity.json");
const PARITY_FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../voice-core/fixtures/turn-endpointing-parity.json"
);
const MODEL_REGISTRY: &str =
    include_str!("../../../../../packages/voice-host/models/registry.json");
const PARITY_VERSION: u32 = 1;
const PARITY_SYNTHETIC_CASES: usize = 10;

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ParityFixture {
    version: u32,
    source: ParitySource,
    options: ParityOptions,
    cases: Vec<ParityCase>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ParitySource {
    corpus: String,
    corpus_version: String,
    model_id: String,
    model_sha256: String,
    generated_by: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ParityOptions {
    speech_threshold: f32,
    minimum_speech_ms: u32,
    trailing_silence_ms: u32,
    maximum_utterance_ms: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ParityCase {
    name: String,
    frame_ms: u32,
    frame_samples: usize,
    frames: Vec<f32>,
    events: Vec<ParityEvent>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ParityEvent {
    frame: usize,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

fn started(frame: usize) -> ParityEvent {
    ParityEvent {
        frame,
        kind: "speech-started".into(),
        duration_ms: None,
        reason: None,
    }
}

fn finalized(frame: usize, duration_ms: u32, reason: &str) -> ParityEvent {
    ParityEvent {
        frame,
        kind: "utterance-finalized".into(),
        duration_ms: Some(duration_ms),
        reason: Some(reason.into()),
    }
}

/// Replays a probability sequence through the production
/// `CaptureSegmenter` and reports the shared event vocabulary of
/// `turn-endpointing.ts`: `speech-started` on the inactiveÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢active frame
/// transition, `utterance-finalized` on a commit (reason inferred from the
/// frame that triggered it: an active frame can only cross the maximum
/// duration, an inactive frame can only cross the trailing silence).
fn replay(frames: &[f32], frame_samples: usize) -> Vec<ParityEvent> {
    let mut segmenter = CaptureSegmenter::new();
    let silence = vec![0_i16; frame_samples];
    let mut events = Vec::new();
    let mut was_active = false;
    for (index, probability) in frames.iter().enumerate() {
        let (active, utterance_id) = segmenter.accept(&silence, Some(*probability));
        if active && !was_active {
            events.push(started(index));
        }
        if let Some(id) = utterance_id {
            let duration_ms = (segmenter.pending[&id].len() as u32 * 1_000) / 16_000;
            let reason = if *probability >= VAD_PROBABILITY_THRESHOLD {
                "maximum-duration"
            } else {
                "silence"
            };
            events.push(finalized(index, duration_ms, reason));
        }
        was_active = active;
    }
    events
}

fn pinned_model_sha256() -> String {
    let registry: serde_json::Value =
        serde_json::from_str(MODEL_REGISTRY).expect("parse model registry");
    registry["models"]
        .as_array()
        .expect("registry model list")
        .iter()
        .find(|model| model["model_id"] == "silero-vad-v6.2.2-onnx")
        .and_then(|model| model["sha256"].as_str())
        .expect("pinned Silero VAD model")
        .to_string()
}

/// The fixture options must stay welded to the live Rust constants (the
/// TS side asserts them against `DEFAULT_TURN_ENDPOINTING_OPTIONS`).
fn assert_live_options(options: &ParityOptions) {
    assert_eq!(options.speech_threshold, VAD_PROBABILITY_THRESHOLD);
    assert_eq!(
        options.minimum_speech_ms as usize,
        MIN_UTTERANCE_SAMPLES * 1_000 / 16_000
    );
    assert_eq!(options.trailing_silence_ms, END_OF_TURN_SILENCE_MS);
    assert_eq!(
        options.maximum_utterance_ms as usize,
        MAX_UTTERANCE_SAMPLES * 1_000 / 16_000
    );
}

fn corpus_frames(fixture: &CorpusFixture, model_dir: &Path) -> Result<Vec<f32>, String> {
    let samples = read_fixture_samples(fixture)?;
    let mut vad = super::vad::SileroVad::load(model_dir)?;
    Ok(vad
        .probabilities(&samples)?
        .into_iter()
        .map(|(_, probability)| probability)
        .collect())
}

const PARITY_SILENCE: f32 = 0.05;
const PARITY_SPEECH: f32 = 0.9;

fn parity_frames(runs: &[(f32, usize)]) -> Vec<f32> {
    let mut frames = Vec::new();
    for (probability, count) in runs {
        frames.extend(std::iter::repeat_n(*probability, *count));
    }
    frames
}

/// Hand-authored boundary cases with literal expected events (an
/// independent oracle for the replay): threshold edge, minimum speech at
/// exactly 280 ms, trailing silence at exactly 650 ms, internal pauses
/// below/above the gate, maximum duration, restart after maximum.
fn synthetic_parity_cases() -> Vec<ParityCase> {
    let mut cases = Vec::new();
    let mut push = |name: &str, frame_ms, frame_samples, frames, events| {
        cases.push(ParityCase {
            name: name.into(),
            frame_ms,
            frame_samples,
            frames,
            events,
        });
    };

    // 5 silent + 10 speech + 21 silent frames: commit fires on the 21st
    // silent frame (672 ms >= 650 ms), never earlier.
    push(
        "synthetic/clean-turn",
        32,
        512,
        parity_frames(&[
            (PARITY_SILENCE, 5),
            (PARITY_SPEECH, 10),
            (PARITY_SILENCE, 21),
        ]),
        vec![started(5), finalized(35, 320, "silence")],
    );

    // 96 ms of speech is below the 280 ms minimum: started, then dropped
    // without an utterance.
    push(
        "synthetic/below-minimum-discarded",
        32,
        512,
        parity_frames(&[(PARITY_SPEECH, 3), (PARITY_SILENCE, 25)]),
        vec![started(0)],
    );

    // Exactly 0.5 starts a turn; the next-below f32 does not, and the
    // single speech frame is later discarded.
    push(
        "synthetic/threshold-edge",
        32,
        512,
        parity_frames(&[(PARITY_SILENCE, 2), (0.5, 1), (0.49999994, 30)]),
        vec![started(2)],
    );

    // 640 ms of silence keeps the turn alive; only the 21st silent frame
    // (672 ms) commits it.
    push(
        "synthetic/trailing-silence-boundary",
        32,
        512,
        parity_frames(&[(PARITY_SPEECH, 10), (PARITY_SILENCE, 21)]),
        vec![started(0), finalized(30, 320, "silence")],
    );

    // A 640 ms internal pause must NOT split the turn; the following
    // 21-silence run commits it once with the full 15-frame duration.
    push(
        "synthetic/internal-pause-resume",
        32,
        512,
        parity_frames(&[
            (PARITY_SPEECH, 10),
            (PARITY_SILENCE, 20),
            (PARITY_SPEECH, 5),
            (PARITY_SILENCE, 21),
        ]),
        vec![started(0), finalized(55, 480, "silence")],
    );

    // A 672 ms internal pause DOES split the turn into two utterances.
    push(
        "synthetic/pause-splits-turn",
        32,
        512,
        parity_frames(&[
            (PARITY_SPEECH, 10),
            (PARITY_SILENCE, 21),
            (PARITY_SPEECH, 10),
            (PARITY_SILENCE, 21),
        ]),
        vec![
            started(0),
            finalized(30, 320, "silence"),
            started(31),
            finalized(61, 320, "silence"),
        ],
    );

    // 200 x 300 ms speech frames commit at exactly 60,000 ms.
    push(
        "synthetic/maximum-duration",
        300,
        4_800,
        parity_frames(&[(PARITY_SPEECH, 200)]),
        vec![started(0), finalized(199, 60_000, "maximum-duration")],
    );

    // After a maximum-duration commit a new turn starts on the next speech
    // frame; with 300 ms frames the trailing silence commits on the frame
    // that crosses 650 ms (900 ms), not after 21 frames.
    push(
        "synthetic/restart-after-max",
        300,
        4_800,
        parity_frames(&[
            (PARITY_SPEECH, 200),
            (PARITY_SILENCE, 5),
            (PARITY_SPEECH, 10),
            (PARITY_SILENCE, 25),
        ]),
        vec![
            started(0),
            finalized(199, 60_000, "maximum-duration"),
            started(205),
            finalized(217, 3_000, "silence"),
        ],
    );

    // Exactly 280 ms of speech (7 x 40 ms) meets the minimum; silence
    // commits on the 17th silent frame (680 ms >= 650 ms).
    push(
        "synthetic/minimum-speech-exact",
        40,
        640,
        parity_frames(&[(PARITY_SPEECH, 7), (PARITY_SILENCE, 25)]),
        vec![started(0), finalized(23, 280, "silence")],
    );

    // Exactly 650 ms of silence (5 x 130 ms) commits on the 5th frame and
    // not on the 4th (520 ms).
    push(
        "synthetic/trailing-silence-exact-650",
        130,
        2_080,
        parity_frames(&[(PARITY_SPEECH, 3), (PARITY_SILENCE, 25)]),
        vec![started(0), finalized(7, 390, "silence")],
    );

    assert_eq!(cases.len(), PARITY_SYNTHETIC_CASES);
    cases
}

/// `EOT_PARITY_REGENERATE=1 cargo test --lib \
///  voice::native_audio::eot_corpus_tests::write_turn_endpointing_parity_fixture \
///  -- --ignored` rewrites the shared fixture from the pinned model.
#[test]
#[ignore = "regenerates the shared turn-endpointing parity fixture"]
fn write_turn_endpointing_parity_fixture() {
    assert_eq!(
        std::env::var("EOT_PARITY_REGENERATE").as_deref(),
        Ok("1"),
        "set EOT_PARITY_REGENERATE=1 to rewrite the parity fixture"
    );
    let corpus: Corpus = serde_json::from_str(CORPUS_JSON).expect("parse corpus JSON");
    let model_dir = std::env::temp_dir().join("unifia-vad-eot-parity");
    let mut cases = synthetic_parity_cases();
    for fixture in &corpus.fixtures {
        let frames = corpus_frames(fixture, &model_dir)
            .unwrap_or_else(|error| panic!("{}: {error}", fixture.id));
        let events = replay(&frames, 512);
        cases.push(ParityCase {
            name: format!("corpus/{}", fixture.id),
            frame_ms: FRAME_MS,
            frame_samples: 512,
            frames,
            events,
        });
    }
    let document = ParityFixture {
        version: PARITY_VERSION,
        source: ParitySource {
            corpus: "unifia-eot-bench".into(),
            corpus_version: "2.0.0".into(),
            model_id: "silero-vad-v6.2.2-onnx".into(),
            model_sha256: pinned_model_sha256(),
            generated_by: "packages/mobile/src-tauri/src/voice/native_audio.rs::\
                 eot_corpus_tests::write_turn_endpointing_parity_fixture"
                .into(),
        },
        options: ParityOptions {
            speech_threshold: VAD_PROBABILITY_THRESHOLD,
            minimum_speech_ms: MIN_UTTERANCE_SAMPLES as u32 * 1_000 / 16_000,
            trailing_silence_ms: END_OF_TURN_SILENCE_MS,
            maximum_utterance_ms: MAX_UTTERANCE_SAMPLES as u32 * 1_000 / 16_000,
        },
        cases,
    };
    let mut json = serde_json::to_string_pretty(&document).expect("serialize parity fixture");
    json.push('\n');
    std::fs::write(PARITY_FIXTURE_PATH, json)
        .unwrap_or_else(|error| panic!("write {}: {error}", PARITY_FIXTURE_PATH));
    println!("wrote {}", PARITY_FIXTURE_PATH);
}

/// Both runtimes replay the committed probability sequences through their
/// endpointing state machines; the Rust half must reproduce the committed
/// events exactly (the TS half is asserted by
/// `packages/app/src/voice/turn-endpointing-parity.test.ts`).
#[test]
fn turn_endpointing_parity_fixture_replays_identically_in_rust() {
    let fixture: ParityFixture =
        serde_json::from_str(PARITY_FIXTURE).expect("parse parity fixture");
    assert_eq!(fixture.version, PARITY_VERSION);
    assert_live_options(&fixture.options);
    assert_eq!(fixture.source.corpus, "unifia-eot-bench");
    assert_eq!(fixture.source.corpus_version, "2.0.0");
    assert_eq!(fixture.source.model_id, "silero-vad-v6.2.2-onnx");
    assert_eq!(fixture.source.model_sha256, pinned_model_sha256());

    let corpus: Corpus = serde_json::from_str(CORPUS_JSON).expect("parse corpus JSON");
    assert_eq!(
        fixture.cases.len(),
        corpus.fixtures.len() + PARITY_SYNTHETIC_CASES
    );
    let mut seen = std::collections::HashSet::new();
    for case in &fixture.cases {
        assert!(
            seen.insert(case.name.as_str()),
            "duplicate parity case {}",
            case.name
        );
        assert_eq!(
            case.frame_samples as u32 * 1_000 / 16_000,
            case.frame_ms,
            "{}: frameSamples/frameMs mismatch",
            case.name
        );
        assert_eq!(
            replay(&case.frames, case.frame_samples),
            case.events,
            "{}: Rust replay diverges from the shared fixture",
            case.name
        );
    }
    for corpus_fixture in &corpus.fixtures {
        let name = format!("corpus/{}", corpus_fixture.id);
        assert!(seen.contains(name.as_str()), "missing parity case {name}");
    }
    assert!(seen.contains("synthetic/clean-turn"));
}

/// The committed corpus sequences must stay faithful to the pinned Silero
/// model on the actual WAV fixtures: fresh model decisions replayed through
/// `CaptureSegmenter` equal the committed events (decision-level equality;
/// float bit-equality across ORT builds is deliberately not required).
#[test]
fn turn_endpointing_parity_fixture_matches_the_pinned_model() {
    let fixture: ParityFixture =
        serde_json::from_str(PARITY_FIXTURE).expect("parse parity fixture");
    let model_dir = std::env::temp_dir().join("unifia-vad-eot-parity");
    let corpus: Corpus = serde_json::from_str(CORPUS_JSON).expect("parse corpus JSON");
    let mut failures: Vec<String> = Vec::new();
    for corpus_fixture in &corpus.fixtures {
        let name = format!("corpus/{}", corpus_fixture.id);
        let case = fixture
            .cases
            .iter()
            .find(|case| case.name == name)
            .unwrap_or_else(|| panic!("missing parity case {name}"));
        let fresh = match corpus_frames(corpus_fixture, &model_dir) {
            Ok(frames) => frames,
            Err(error) => {
                failures.push(error);
                continue;
            }
        };
        if fresh.len() != case.frames.len() {
            failures.push(format!(
                "{name}: pinned model produced {} frames, fixture stores {}",
                fresh.len(),
                case.frames.len()
            ));
            continue;
        }
        let events = replay(&fresh, case.frame_samples);
        if events != case.events {
            failures.push(format!(
                "{name}: fresh model decisions diverge from the fixture\n\
                 fresh:  {events:#?}\n\
                 stored: {:#?}",
                case.events
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "parity fixture faithfulness failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Reference `gate_decisions` of the pinned bake-off candidate C
/// (`smart-turn-persist`), exported by `scripts/voice/eot_bakeoff_smart_turn.py`
/// into `packages/voice-core/fixtures/smart-turn-gate.json`.
#[derive(serde::Deserialize)]
struct GateFixtureReference {
    version: u32,
    source: String,
    candidate: String,
    runtime: GateFixtureRuntime,
    model: GateFixtureModel,
    decisions: Vec<GateFixtureDecision>,
}

#[derive(serde::Deserialize)]
struct GateFixtureRuntime {
    onnxruntime: String,
    intra_threads: u32,
}

#[derive(serde::Deserialize)]
struct GateFixtureModel {
    model_id: String,
    sha256: String,
}

#[derive(serde::Deserialize)]
struct GateFixtureDecision {
    fixture: String,
    kind: String,
    trigger_ms: u32,
    probability: Option<f32>,
    accepted: bool,
    forced: bool,
}

fn pinned_smart_turn_sha256() -> String {
    let registry: serde_json::Value =
        serde_json::from_str(MODEL_REGISTRY).expect("parse model registry");
    registry["models"]
        .as_array()
        .expect("registry model list")
        .iter()
        .find(|model| model["model_id"] == "smart-turn-v3.2-cpu-onnx")
        .and_then(|model| model["sha256"].as_str())
        .expect("pinned Smart Turn model")
        .to_string()
}

const GATE_REFERENCE_FIXTURE: &str =
    include_str!("../../../../voice-core/fixtures/smart-turn-gate.json");

/// ONNX Runtime version bundled by `ort-sys` for this crate. The reference
/// fixture must be generated with the *same* runtime: ORT probabilities on
/// identical features drift by up to ~0.24 across minor versions, which is
/// far beyond the 0.01 parity tolerance. Regenerate with
/// `uv run --with onnxruntime==1.28.0 python scripts/voice/eot_bakeoff_smart_turn.py`.
const REFERENCE_ORT_VERSION: &str = "1.28.0";

/// The production candidate (policy C): every trailing-silence trigger runs
/// the pinned Smart Turn model over the raw
/// `[turn_start - 500 ms : trigger]` window, a veto defers the commit to
/// the bounded 128 ms deterministic cap, and the resulting emissions must
/// stay inside the calibrated G4 budgets of `unifia-eot-bench` v2.0.0. The
/// drained decisions must also match the exported bake-off reference
/// fixture decision-for-decision (kind, trigger, verdict; probability
/// within 0.01 of the Python run).
#[test]
fn smart_turn_gated_corpus_meets_the_policy_c_budgets_and_parity() {
    let corpus: Corpus = serde_json::from_str(CORPUS_JSON).expect("parse corpus JSON");
    let reference: GateFixtureReference =
        serde_json::from_str(GATE_REFERENCE_FIXTURE).expect("parse gate reference fixture");
    assert_eq!(reference.version, 1);
    assert_eq!(reference.source, "scripts/voice/eot_bakeoff_smart_turn.py");
    assert_eq!(reference.candidate, "smart-turn-persist");
    assert_eq!(reference.model.model_id, "smart-turn-v3.2-cpu-onnx");
    assert_eq!(reference.model.sha256, pinned_smart_turn_sha256());
    assert_eq!(
        reference.runtime.onnxruntime, REFERENCE_ORT_VERSION,
        "gate reference fixture was not generated with the ONNX Runtime \
         bundled by ort-sys; regenerate it (see REFERENCE_ORT_VERSION)"
    );
    assert_eq!(reference.runtime.intra_threads, 1);

    let model_dir = std::env::temp_dir().join("unifia-vad-eot-corpus");
    let mut turn = super::smart_turn::SmartTurn::load(&model_dir)
        .unwrap_or_else(|error| panic!("Smart Turn load failed: {error}"));
    let active_fixture = std::cell::RefCell::new(String::new());
    let gate_invocation = std::cell::Cell::new(0_usize);
    let mut gate = |window: &[i16]| {
        gate_invocation.set(gate_invocation.get() + 1);
        let pcm_bytes = window
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect::<Vec<_>>();
        eprintln!(
            "SMART_TURN_INPUT fixture={} decision={} samples={} sha256={}",
            active_fixture.borrow(),
            gate_invocation.get(),
            window.len(),
            hex::encode(Sha256::digest(pcm_bytes)),
        );
        turn.predict(window)
    };
    let mut errors = Vec::new();
    let mut outcomes = Vec::new();
    for fixture in &corpus.fixtures {
        *active_fixture.borrow_mut() = fixture.id.clone();
        gate_invocation.set(0);
        match evaluate(fixture, &model_dir, Some(&mut gate)) {
            Ok(outcome) => outcomes.push(outcome),
            Err(error) => errors.push(error),
        }
    }
    assert!(errors.is_empty(), "gated pipeline failures:\n{errors:#?}");
    assert_eq!(outcomes.len(), 91);

    // Gate telemetry: the model must actually run, verdicts must respect
    // the strict 0.5 threshold, the bounded cap resolves vetoes, and a
    // loaded model must never trip the deterministic fallback.
    let mut evaluations = 0_usize;
    let mut vetoes = 0_usize;
    let mut forced = 0_usize;
    for outcome in &outcomes {
        assert!(
            !outcome.gate_fallback,
            "{}: gate fallback fired with a loaded model",
            outcome.id
        );
        for decision in &outcome.gate_decisions {
            match decision.kind {
                "trailing-silence" => {
                    evaluations += 1;
                    if !decision.accepted {
                        vetoes += 1;
                    }
                    let probability = decision
                        .probability
                        .expect("an evaluation always records its probability");
                    assert!(
                        (0.0..=1.0).contains(&probability),
                        "{}: probability {probability} outside [0, 1]",
                        outcome.id
                    );
                    let above = probability > super::smart_turn::SMART_TURN_THRESHOLD;
                    assert_eq!(
                        decision.accepted, above,
                        "{}: verdict disagrees with the strict threshold \
                         (probability {probability}, accepted {})",
                        outcome.id, decision.accepted
                    );
                }
                "trailing-silence-veto-cap" => {
                    forced += 1;
                    assert!(
                        decision.forced && decision.accepted && decision.probability.is_none(),
                        "{}: malformed veto-cap decision {decision:?}",
                        outcome.id
                    );
                }
                other => panic!("{}: unexpected gate decision kind {other}", outcome.id),
            }
        }
    }
    assert!(evaluations > 0, "the Smart Turn model never ran");
    assert!(
        vetoes > 0 && forced > 0,
        "policy-C bounds never exercised (vetoes={vetoes}, forced={forced})"
    );
    assert!(
        forced <= vetoes,
        "a veto-cap commit can only resolve a prior veto (forced={forced}, \
         vetoes={vetoes})"
    );

    // Decision-level parity with the exported bake-off run.
    let mut reference_by_fixture: BTreeMap<&str, Vec<&GateFixtureDecision>> = BTreeMap::new();
    for decision in &reference.decisions {
        reference_by_fixture
            .entry(decision.fixture.as_str())
            .or_default()
            .push(decision);
    }
    let mut parity_failures: Vec<String> = Vec::new();
    for outcome in &outcomes {
        let expected = reference_by_fixture
            .get(outcome.id.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default();
        if expected.len() != outcome.gate_decisions.len() {
            parity_failures.push(format!(
                "{}: {} reference decisions vs {} Rust decisions",
                outcome.id,
                expected.len(),
                outcome.gate_decisions.len()
            ));
            continue;
        }
        for (index, (got, want)) in outcome.gate_decisions.iter().zip(expected).enumerate() {
            if got.kind != want.kind
                || got.trigger_ms != want.trigger_ms
                || got.accepted != want.accepted
                || got.forced != want.forced
            {
                parity_failures.push(format!(
                    "{}: decision {index} diverges: Rust=({} {}ms accepted={} \
                     forced={}) reference=({} {}ms accepted={} forced={})",
                    outcome.id,
                    got.kind,
                    got.trigger_ms,
                    got.accepted,
                    got.forced,
                    want.kind,
                    want.trigger_ms,
                    want.accepted,
                    want.forced
                ));
                continue;
            }
            match (got.probability, want.probability) {
                (Some(got), Some(want)) if (got - want).abs() <= 0.01 => {}
                (None, None) => {}
                (got, want) => parity_failures.push(format!(
                    "{}: decision {index} probability {got:?} vs reference \
                     {want:?} (tolerance 0.01)",
                    outcome.id
                )),
            }
        }
    }
    assert!(
        parity_failures.is_empty(),
        "gate decision parity failures ({}):\n{}",
        parity_failures.len(),
        parity_failures.join("\n")
    );

    let failures = budget_failures(&outcomes);
    assert!(
        failures.is_empty(),
        "G4 policy-C benchmark violations ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}
