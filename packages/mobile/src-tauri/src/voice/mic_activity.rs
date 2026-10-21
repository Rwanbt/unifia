// SPDX-License-Identifier: MIT

//! What the microphone is doing right now, from the captured audio alone.
//! Two outputs drive the interface: a smoothed level for the microphone button,
//! and an automatic stop after a long silence. Pure and deterministic: every
//! rule is a function of the blocks pushed, never of a clock.

pub(crate) const SAMPLE_RATE_HZ: usize = 16_000;
/// Silence that ends dictation automatically, matching the system recognizers.
pub(crate) const SILENCE_STOP_MS: u64 = 8_000;
/// Mean amplitude that counts as speech (about -41 dBFS).
pub(crate) const SPEECH_RMS: f32 = 300.0;
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Reading {
    /// Smoothed level in `0.0..=1.0`, for the microphone button.
    pub(crate) level: f32,
    /// True once speech has been heard and the silence lasted long enough.
    pub(crate) auto_stop: bool,
}

#[derive(Debug, Default)]
pub(crate) struct Meter {
    level: f32,
    silence_ms: u64,
    heard_speech: bool,
}

impl Meter {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Consumes one captured block of `block_ms` audio.
    pub(crate) fn push(&mut self, block: &[i16], block_ms: u64) -> Reading {
        let energy = rms(block);
        let target = (energy / FULL_SCALE_RMS).clamp(0.0, 1.0);
        let rate = if target > self.level { ATTACK } else { RELEASE };
        self.level += (target - self.level) * rate;
        self.level = self.level.clamp(0.0, 1.0);

        if energy >= SPEECH_RMS {
            self.heard_speech = true;
            self.silence_ms = 0;
        } else {
            self.silence_ms += block_ms;
        }

        Reading {
            level: self.level,
            auto_stop: self.heard_speech && self.silence_ms >= SILENCE_STOP_MS,
        }
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
    fn silence_reports_no_speech_and_no_stop() {
        let mut meter = Meter::new();
        let reading = meter.push(&vec![0_i16; block(20)], 20);
        assert_eq!(reading.level, 0.0);
        assert!(!reading.auto_stop);
    }

    #[test]
    fn the_level_rises_fast_and_falls_slowly() {
        let mut meter = Meter::new();
        let loud = tone(5_000, block(20));
        let first = meter.push(&loud, 20);
        let second = meter.push(&loud, 20);
        assert!(first.level > 0.0);
        assert!(second.level > first.level, "attack keeps rising");
        let quiet = meter.push(&vec![0_i16; block(20)], 20);
        assert!(quiet.level > 0.0, "release keeps the level up");
        assert!(quiet.level < second.level);
    }

    #[test]
    fn a_full_scale_block_stays_inside_the_unit_range() {
        let mut meter = Meter::new();
        for _ in 0..50 {
            let reading = meter.push(&tone(i16::MAX, block(20)), 20);
            assert!((0.0..=1.0).contains(&reading.level), "{}", reading.level);
        }
    }

    #[test]
    fn silence_never_stops_a_dictation_that_heard_no_speech() {
        let mut meter = Meter::new();
        for _ in 0..600 {
            assert!(!meter.push(&vec![0_i16; block(20)], 20).auto_stop);
        }
    }

    #[test]
    fn eight_seconds_of_silence_after_speech_stop_the_dictation() {
        let mut meter = Meter::new();
        meter.push(&tone(5_000, block(20)), 20);
        for _ in 0..399 {
            assert!(!meter.push(&vec![0_i16; block(20)], 20).auto_stop);
        }
        assert!(meter.push(&vec![0_i16; block(20)], 20).auto_stop);
    }

    #[test]
    fn speech_resets_the_silence_counter() {
        let mut meter = Meter::new();
        meter.push(&tone(5_000, block(20)), 20);
        for _ in 0..300 {
            meter.push(&vec![0_i16; block(20)], 20);
        }
        assert!(!meter.push(&tone(5_000, block(20)), 20).auto_stop);
        assert!(
            !meter.push(&vec![0_i16; block(20)], 20).auto_stop,
            "counter restarted"
        );
    }

    #[test]
    fn the_silence_threshold_is_the_eight_second_system_default() {
        assert_eq!(SILENCE_STOP_MS, 8_000);
    }
}
