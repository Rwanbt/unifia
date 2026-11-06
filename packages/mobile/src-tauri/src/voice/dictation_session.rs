// SPDX-License-Identifier: MIT

//! The state of one running dictation, independent of the audio device: the
//! capped buffer, the microphone meter, the silence tracker and the live-preview
//! schedule. The capture session feeds it one block at a time and acts on the
//! report.

use super::dictation_rules::{DictationBuffer, SAMPLE_RATE_HZ};
use super::mic_activity::{Meter, Silence};
use super::preview_cadence::next_due;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct BlockReport {
    /// The buffer reached its one-minute cap with this block.
    pub(crate) full: bool,
    /// A live preview is due at this point of the recording.
    pub(crate) preview_due: bool,
    pub(crate) level: f32,
}

#[derive(Debug)]
pub(crate) struct DictationSession {
    buffer: DictationBuffer,
    meter: Meter,
    silence: Silence,
    preview_due_ms: u64,
}

impl DictationSession {
    pub(crate) fn new() -> Self {
        Self {
            buffer: DictationBuffer::new(),
            meter: Meter::new(),
            silence: Silence::new(),
            preview_due_ms: next_due(0),
        }
    }

    pub(crate) fn push_block(&mut self, samples: &[i16]) -> BlockReport {
        let level = self.meter.push(samples);
        let full = self.buffer.push(samples);
        let audio_ms = self.buffer.len() as u64 * 1000 / SAMPLE_RATE_HZ as u64;
        let preview_due = audio_ms >= self.preview_due_ms;
        if preview_due {
            self.preview_due_ms = next_due(self.preview_due_ms);
        }
        BlockReport {
            full,
            preview_due,
            level,
        }
    }

    /// Feeds the voice-activity decision for one captured block of `block_ms`
    /// audio. Returns true when the dictation must stop.
    pub(crate) fn observe_activity(&mut self, speaking: bool, block_ms: u64) -> bool {
        self.silence.push(speaking, block_ms)
    }

    /// Keeps the audio already captured and restarts the meter and the preview schedule.
    pub(crate) fn restart(&mut self) {
        self.meter = Meter::new();
        self.silence = Silence::new();
        self.preview_due_ms = next_due(0);
    }

    pub(crate) fn buffer(&self) -> &DictationBuffer {
        &self.buffer
    }

    pub(crate) fn into_buffer(self) -> DictationBuffer {
        self.buffer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: usize = 16_000;

    fn speech(samples: usize) -> Vec<i16> {
        vec![5_000; samples]
    }

    fn silence(samples: usize) -> Vec<i16> {
        vec![0; samples]
    }

    #[test]
    fn a_preview_is_due_on_the_cadence_of_the_recording() {
        let mut session = DictationSession::new();
        let due: Vec<bool> = (0..4)
            .map(|_| session.push_block(&speech(SECOND)).preview_due)
            .collect();
        assert_eq!(due, vec![true, false, true, false]);
    }

    #[test]
    fn eight_seconds_of_silence_after_speech_ask_for_an_automatic_stop() {
        let mut session = DictationSession::new();
        session.push_block(&speech(SECOND));
        assert!(!session.observe_activity(true, 0));
        let stops: Vec<bool> = (0..8)
            .map(|_| session.observe_activity(false, 1_000))
            .collect();
        assert_eq!(
            stops,
            vec![false, false, false, false, false, false, false, true]
        );
    }

    #[test]
    fn a_dictation_that_never_heard_speech_never_asks_to_stop() {
        let mut session = DictationSession::new();
        for _ in 0..20 {
            assert!(!session.observe_activity(false, 1_000));
        }
    }

    #[test]
    fn the_buffer_reports_full_at_one_minute_and_keeps_the_audio() {
        let mut session = DictationSession::new();
        let mut last = session.push_block(&speech(SECOND));
        for _ in 1..60 {
            last = session.push_block(&speech(SECOND));
        }
        assert!(last.full);
        assert_eq!(session.buffer().len(), 60 * SECOND);
    }

    #[test]
    fn restart_keeps_the_captured_audio_and_rearms_the_preview() {
        let mut session = DictationSession::new();
        session.push_block(&speech(SECOND));
        session.push_block(&speech(SECOND));
        session.restart();
        let report = session.push_block(&speech(SECOND));
        assert!(report.preview_due);
        assert_eq!(session.buffer().len(), 3 * SECOND);
    }

    #[test]
    fn restart_clears_the_silence_heard_before_it() {
        let mut session = DictationSession::new();
        assert!(!session.observe_activity(true, 1_000));
        session.restart();
        for _ in 0..20 {
            assert!(!session.observe_activity(false, 1_000), "speech forgotten");
        }
    }

    #[test]
    fn the_level_follows_the_energy_of_the_block() {
        let mut session = DictationSession::new();
        let quiet = session.push_block(&silence(SECOND)).level;
        let loud = session.push_block(&speech(SECOND)).level;
        assert!(loud > quiet);
    }
}
