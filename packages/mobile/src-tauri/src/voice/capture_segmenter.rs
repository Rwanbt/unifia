// SPDX-License-Identifier: MIT
//! Deterministic capture segmenter with the Smart Turn turn gate (G4).
//!
//! Owns the utterance state machine shared by the Android capture path and
//! the corpus/parity tests: speech activation, trailing-silence commit,
//! maximum-duration commit, plus the policy-C Smart Turn gate — one
//! inference per trailing-silence trigger over the raw window
//! `[turn_start - 500 ms : trigger]` (last 8 s kept), a bounded 128 ms
//! deterministic fallback after a veto, and observable fallback telemetry.
//! Behaviour without a gate (`gate = None`) is the pinned deterministic
//! candidate A of the EOT corpus (anchors the cross-runtime parity fixture).

use std::collections::{HashMap, VecDeque};

pub(crate) const VOICE_THRESHOLD: f32 = 0.018;
pub(crate) const VAD_PROBABILITY_THRESHOLD: f32 = 0.5;
pub(crate) const END_OF_TURN_SILENCE_MS: u32 = 650;
pub(crate) const MAX_UTTERANCE_SAMPLES: usize = 16_000 * 60;
pub(crate) const MIN_UTTERANCE_SAMPLES: usize = 16_000 * 280 / 1_000;
pub(crate) const MAX_PENDING_UTTERANCES: usize = 2;
/// Smart Turn gate window lead-in (campaign §19): 500 ms of raw PCM before
/// the turn start, mirroring `PRE_SPEECH_SAMPLES` of the G4 bake-off.
pub(crate) const PRE_SPEECH_SAMPLES: u64 = 8_000;
/// Smart Turn window cap: only the last 8 s of raw PCM can reach the model
/// (`smart_turn::SmartTurn::predict` caps/pads to its 8 s input), so the
/// ring keeps exactly that horizon and no more.
pub(crate) const TURN_GATE_WINDOW_SAMPLES: usize = 128_000;
/// Policy C bounded deterministic fallback: commit the utterance 128 ms
/// (4 × 512-sample frames) after the first veto, without further inference.
pub(crate) const TURN_GATE_PERSIST_SAMPLES: u64 = 2_048;

/// Gate decision telemetry for one Smart Turn evaluation, drained by the
/// corpus/parity tests (mirrors the bake-off `gate_decisions` records).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GateDecision {
    pub(crate) kind: &'static str,
    pub(crate) trigger_ms: u32,
    pub(crate) probability: Option<f32>,
    pub(crate) accepted: bool,
    pub(crate) forced: bool,
}

pub(crate) struct CaptureSegmenter {
    pub(crate) samples: Vec<i16>,
    pub(crate) pending: HashMap<u64, Vec<i16>>,
    next_id: u64,
    pub(crate) speech_active: bool,
    silent_ms: u32,
    background_rms: f32,
    pub(crate) vad_fallback: bool,
    /// Total PCM samples processed before the current `accept` call.
    cursor: u64,
    /// Sample index where the current turn first became active (cleared on
    /// commit); anchors the Smart Turn gate window.
    turn_start: Option<u64>,
    /// Raw capture ring (last 8 s) — the exact source of the gate window.
    recent: VecDeque<i16>,
    /// First-veto cursor of the current silence run (policy C).
    veto_cursor: Option<u64>,
    pub(crate) gate_evaluations: u32,
    pub(crate) gate_vetoes: u32,
    pub(crate) gate_forced: u32,
    pub(crate) gate_fallback: bool,
    /// Most recent gate decision, set only on frames that ran a gate call.
    pub(crate) last_gate: Option<GateDecision>,
}

impl CaptureSegmenter {
    pub(crate) fn new() -> Self {
        Self {
            samples: Vec::with_capacity(MIN_UTTERANCE_SAMPLES),
            pending: HashMap::new(),
            next_id: 1,
            speech_active: false,
            silent_ms: 0,
            background_rms: 0.006,
            vad_fallback: false,
            cursor: 0,
            turn_start: None,
            recent: VecDeque::with_capacity(TURN_GATE_WINDOW_SAMPLES),
            veto_cursor: None,
            gate_evaluations: 0,
            gate_vetoes: 0,
            gate_forced: 0,
            gate_fallback: false,
            last_gate: None,
        }
    }

    /// Deterministic path (candidate A): no turn gate, trailing-silence and
    /// maximum-duration commits only.
    pub(crate) fn accept(
        &mut self,
        samples: &[i16],
        probability: Option<f32>,
    ) -> (bool, Option<u64>) {
        self.accept_gated(
            samples,
            probability,
            None::<&mut dyn FnMut(&[i16]) -> Result<(bool, f32), String>>,
        )
    }

    /// Gated path (policy C): identical to [`Self::accept`] plus the turn
    /// gate consulted at every trailing-silence trigger.
    pub(crate) fn accept_gated<F: FnMut(&[i16]) -> Result<(bool, f32), String> + ?Sized>(
        &mut self,
        samples: &[i16],
        probability: Option<f32>,
        gate: Option<&mut F>,
    ) -> (bool, Option<u64>) {
        if samples.is_empty() {
            return (self.speech_active, None);
        }
        let cursor = self.cursor;
        self.cursor = self.cursor.saturating_add(samples.len() as u64);
        self.last_gate = None;
        for &sample in samples {
            if self.recent.len() == TURN_GATE_WINDOW_SAMPLES {
                self.recent.pop_front();
            }
            self.recent.push_back(sample);
        }
        let square_mean = samples
            .iter()
            .map(|sample| {
                let normalized = *sample as f32 / i16::MAX as f32;
                normalized * normalized
            })
            .sum::<f32>()
            / samples.len() as f32;
        let rms = square_mean.sqrt();
        let active = match probability {
            Some(probability) => probability >= VAD_PROBABILITY_THRESHOLD,
            None => {
                self.vad_fallback = true;
                rms >= VOICE_THRESHOLD.max(self.background_rms * 3.0)
            }
        };
        if !self.speech_active && !active {
            self.background_rms = self.background_rms * 0.96 + rms * 0.04;
            return (false, None);
        }

        if active {
            self.speech_active = true;
            self.silent_ms = 0;
            self.veto_cursor = None;
            if self.turn_start.is_none() {
                self.turn_start = Some(cursor);
            }
            let remaining = MAX_UTTERANCE_SAMPLES.saturating_sub(self.samples.len());
            self.samples
                .extend_from_slice(&samples[..samples.len().min(remaining)]);
        } else if self.speech_active {
            self.silent_ms = self
                .silent_ms
                .saturating_add(((samples.len() as u64 * 1_000) / 16_000).max(1) as u32);
            if self.silent_ms >= END_OF_TURN_SILENCE_MS {
                if let Some(gate) = gate {
                    return self.gate_commit(cursor, samples.len() as u64, gate);
                }
                return (false, self.finish_utterance());
            }
        }

        if self.samples.len() >= MAX_UTTERANCE_SAMPLES {
            // Maximum-duration stays deterministic and ungated (§19 policy C).
            return (false, self.finish_utterance());
        }
        (self.speech_active, None)
    }

    /// Runs the turn gate at a trailing-silence trigger (policy C): one
    /// evaluation per silence run; a veto defers the commit to a bounded
    /// deterministic fallback `TURN_GATE_PERSIST_SAMPLES` after the first
    /// veto; a gate error commits deterministically and stays observable.
    fn gate_commit<F: FnMut(&[i16]) -> Result<(bool, f32), String> + ?Sized>(
        &mut self,
        cursor: u64,
        frame_samples: u64,
        gate: &mut F,
    ) -> (bool, Option<u64>) {
        let trigger_ms = u32::try_from((cursor / 512 + 1) * 32).unwrap_or(u32::MAX);
        if let Some(veto) = self.veto_cursor {
            if cursor.saturating_sub(veto) < TURN_GATE_PERSIST_SAMPLES {
                // Still inside the bounded window: hold, no re-inference.
                return (true, None);
            }
            self.gate_forced += 1;
            self.last_gate = Some(GateDecision {
                kind: "trailing-silence-veto-cap",
                trigger_ms,
                probability: None,
                accepted: true,
                forced: true,
            });
            return (false, self.finish_utterance());
        }
        let window = self.gate_window(cursor + frame_samples);
        self.gate_evaluations += 1;
        let started = std::time::Instant::now();
        match gate(&window) {
            Ok((accepted, probability)) => {
                let e2e_ms = started.elapsed().as_secs_f64() * 1_000.0;
                self.last_gate = Some(GateDecision {
                    kind: "trailing-silence",
                    trigger_ms,
                    probability: Some(probability),
                    accepted,
                    forced: false,
                });
                if accepted {
                    log::debug!("[voice] Smart Turn accepted EOT (+{e2e_ms:.2} ms)");
                    return (false, self.finish_utterance());
                }
                self.gate_vetoes += 1;
                self.veto_cursor = Some(cursor);
                (true, None)
            }
            Err(error) => {
                log::warn!("[voice] Smart Turn gate failed; deterministic commit: {error}");
                self.gate_fallback = true;
                self.last_gate = None;
                (false, self.finish_utterance())
            }
        }
    }

    /// Raw PCM window `[turn_start - 500 ms : trigger]`, capped to the last
    /// `TURN_GATE_WINDOW_SAMPLES` samples — an exact replica of the bake-off
    /// slice `wav[max(0, turn_start - PRE_SPEECH) : cursor + FRAME]` followed
    /// by the model's own last-8 s cap.
    fn gate_window(&self, end: u64) -> Vec<i16> {
        let start = self.turn_start.map_or(0, |turn_start| {
            turn_start.saturating_sub(PRE_SPEECH_SAMPLES)
        });
        let needed = end.saturating_sub(start) as usize;
        let available = self.recent.len();
        let take = needed.min(available);
        self.recent.iter().skip(available - take).copied().collect()
    }

    fn finish_utterance(&mut self) -> Option<u64> {
        self.speech_active = false;
        self.silent_ms = 0;
        self.veto_cursor = None;
        self.turn_start = None;
        if self.samples.len() < MIN_UTTERANCE_SAMPLES {
            self.samples.clear();
            return None;
        }
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        if self.pending.len() >= MAX_PENDING_UTTERANCES {
            if let Some(oldest) = self.pending.keys().min().copied() {
                self.pending.remove(&oldest);
            }
        }
        self.pending.insert(id, std::mem::take(&mut self.samples));
        self.samples = Vec::with_capacity(MIN_UTTERANCE_SAMPLES);
        Some(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segmenter_emits_bounded_pcm_after_silence() {
        let mut segmenter = CaptureSegmenter::new();
        let speech = vec![2_000_i16; 512 * 9];
        for frame in speech.chunks(512) {
            assert_eq!(segmenter.accept(frame, Some(0.9)), (true, None));
        }
        let silence = vec![0_i16; 512];
        let mut emitted = None;
        for _ in 0..20 {
            let (_, utterance_id) = segmenter.accept(&silence, Some(0.0));
            emitted = emitted.or(utterance_id);
            assert!(emitted.is_none(), "650 ms trailing silence has not elapsed");
        }
        let (_, utterance_id) = segmenter.accept(&silence, Some(0.0));
        emitted = emitted.or(utterance_id);
        let id = emitted.expect("speech should be emitted after the end-of-turn silence");
        assert_eq!(segmenter.pending.remove(&id).unwrap().len(), speech.len());
        assert!(segmenter.samples.capacity() <= MIN_UTTERANCE_SAMPLES * 2);
    }
}
