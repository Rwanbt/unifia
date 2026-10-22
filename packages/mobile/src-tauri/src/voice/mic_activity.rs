// SPDX-License-Identifier: MIT

//! What the microphone is doing right now.
//! The smoothed level drives the microphone button; the silence tracker decides
//! the automatic stop. Both are pure: every rule is a function of the values
//! pushed, never of a clock.

pub(crate) const SAMPLE_RATE_HZ: usize = 16_000;
/// Silence that ends dictation automatically, matching the system recognizers.
pub(crate) const SILENCE_STOP_MS: u64 = 8_000;
/// Amplitude mapped to a full level, so normal speech fills the button.
pub(crate) const FULL_SCALE_RMS: f32 = 6_000.0;
/// Rise per block: the button answers quickly.
pub(crate) const ATTACK: f32 = 0.5;
/// Fall per block: the button settles slowly instead of flickering.
pub(crate) const RELEASE: f32 = 0.12;

pub(crate) fn rms(block: &[i16]) -> f32 {
    if block.is_empty() {
        return 0.0;
    }
    let sum: f64 = block
        .iter()
        .map(|sample| {
            let value = f64::from(*sample);
            value * value
        })
        .sum();
    (sum / block.len() as f64).sqrt() as f32
}

/// Smooths the captured amplitude into the level shown on the microphone button.
#[derive(Debug, Default)]
pub(crate) struct Meter {
    level: f32,
}

impl Meter {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Consumes one captured block and returns the smoothed level in `0.0..=1.0`.
    pub(crate) fn push(&mut self, block: &[i16]) -> f32 {
        let target = (rms(block) / FULL_SCALE_RMS).clamp(0.0, 1.0);
        let rate = if target > self.level { ATTACK } else { RELEASE };
        self.level += (target - self.level) * rate;
        self.level = self.level.clamp(0.0, 1.0);
        self.level
    }
}

/// Counts the silence that follows speech, from the voice-activity decision.
///
/// WHY NOT AN AMPLITUDE THRESHOLD: the capture runs with `VoiceCommunication`,
/// whose automatic gain control keeps the residual level high long after a
/// sentence ends. An RMS threshold then never sees silence and the dictation
/// runs until the one-minute cap. The detector's own speech decision is
/// immune to that gain and is the same signal Live uses for its turns.
#[derive(Debug, Default)]
pub(crate) struct Silence {
    silence_ms: u64,
    heard_speech: bool,
}

impl Silence {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Consumes one block the detector judged as speech or not, and returns true
    /// once speech was heard and [`SILENCE_STOP_MS`] of silence followed it.
    pub(crate) fn push(&mut self, speaking: bool, block_ms: u64) -> bool {
        if speaking {
            self.heard_speech = true;
            self.silence_ms = 0;
        } else {
            self.silence_ms += block_ms;
        }
        self.heard_speech && self.silence_ms >= SILENCE_STOP_MS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(amplitude: i16, samples: usize) -> Vec<i16> {
        (0..samples)
            .map(|index| {
                if index % 2 == 0 {
                    amplitude
                } else {
                    -amplitude
                }
            })
            .collect()
    }

    fn block(ms: u64) -> usize {
        (SAMPLE_RATE_HZ as u64 * ms / 1000) as usize
    }

    #[test]
    fn silence_reports_no_level() {
        let mut meter = Meter::new();
        assert_eq!(meter.push(&vec![0_i16; block(20)]), 0.0);
    }

    #[test]
    fn the_level_rises_fast_and_falls_slowly() {
        let mut meter = Meter::new();
        let loud = tone(5_000, block(20));
        let first = meter.push(&loud);
        let second = meter.push(&loud);
        assert!(first > 0.0);
        assert!(second > first, "attack keeps rising");
        let quiet = meter.push(&vec![0_i16; block(20)]);
        assert!(quiet > 0.0, "release keeps the level up");
        assert!(quiet < second);
    }

    #[test]
    fn a_full_scale_block_stays_inside_the_unit_range() {
        let mut meter = Meter::new();
        for _ in 0..50 {
            let level = meter.push(&tone(i16::MAX, block(20)));
            assert!((0.0..=1.0).contains(&level), "{level}");
        }
    }

    #[test]
    fn silence_never_stops_a_dictation_that_heard_no_speech() {
        let mut silence = Silence::new();
        for _ in 0..600 {
            assert!(!silence.push(false, 20));
        }
    }

    #[test]
    fn eight_seconds_of_silence_after_speech_stop_the_dictation() {
        let mut silence = Silence::new();
        assert!(!silence.push(true, 20));
        for _ in 0..399 {
            assert!(!silence.push(false, 20));
        }
        assert!(silence.push(false, 20));
    }

    #[test]
    fn speech_resets_the_silence_counter() {
        let mut silence = Silence::new();
        silence.push(true, 20);
        for _ in 0..300 {
            silence.push(false, 20);
        }
        assert!(!silence.push(true, 20));
        assert!(!silence.push(false, 20), "counter restarted");
    }

    #[test]
    fn a_quiet_block_does_not_start_the_silence_clock() {
        let mut silence = Silence::new();
        for _ in 0..600 {
            assert!(!silence.push(false, 20), "no speech heard yet");
        }
        assert!(!silence.push(true, 20));
        assert!(!silence.push(false, 20), "the clock starts after speech");
    }

    #[test]
    fn the_silence_threshold_is_the_eight_second_system_default() {
        assert_eq!(SILENCE_STOP_MS, 8_000);
    }
}
