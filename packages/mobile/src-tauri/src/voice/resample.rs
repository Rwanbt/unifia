// SPDX-License-Identifier: MIT

//! 48 kHz → 16 kHz decimation with a fixed linear-phase FIR low-pass. The
//! filter keeps its state between chunks, so the output depends only on the
//! input samples, never on how the capture was split.

pub(crate) const DECIMATION: usize = 3;
const TAP_COUNT: usize = 63;
/// Cut-off as a fraction of the 48 kHz input rate (≈ 6.7 kHz). The stop band
/// starts at 8 kHz, the 16 kHz Nyquist frequency, so aliasing is suppressed.
const CUTOFF_NORMALIZED: f64 = 0.14;

#[derive(Debug)]
pub(crate) struct Decimator {
    taps: Vec<f32>,
    line: Vec<f32>,
    phase: usize,
}

impl Decimator {
    pub(crate) fn new() -> Self {
        Self {
            taps: design_taps(),
            line: vec![0.0; TAP_COUNT],
            phase: 0,
        }
    }

    /// Returns one output sample per [`DECIMATION`] input samples, carrying the
    /// position across calls.
    pub(crate) fn process(&mut self, input: &[i16]) -> Vec<i16> {
        let mut output = Vec::with_capacity(input.len() / DECIMATION + 1);
        for &sample in input {
            self.line.rotate_right(1);
            self.line[0] = f32::from(sample);
            if self.phase == 0 {
                let accumulator: f32 = self
                    .taps
                    .iter()
                    .zip(self.line.iter())
                    .map(|(tap, value)| tap * value)
                    .sum();
                output.push(accumulator.round().clamp(-32_768.0, 32_767.0) as i16);
            }
            self.phase = (self.phase + 1) % DECIMATION;
        }
        output
    }
}

fn design_taps() -> Vec<f32> {
    let centre = (TAP_COUNT - 1) as f64 / 2.0;
    let mut taps: Vec<f64> = (0..TAP_COUNT)
        .map(|index| {
            let offset = index as f64 - centre;
            let sinc = if offset == 0.0 {
                2.0 * CUTOFF_NORMALIZED
            } else {
                (2.0 * std::f64::consts::PI * CUTOFF_NORMALIZED * offset).sin()
                    / (std::f64::consts::PI * offset)
            };
            let window = 0.54
                - 0.46 * (2.0 * std::f64::consts::PI * index as f64 / (TAP_COUNT - 1) as f64).cos();
            sinc * window
        })
        .collect();
    let sum: f64 = taps.iter().sum();
    taps.iter_mut().for_each(|tap| *tap /= sum);
    taps.into_iter().map(|tap| tap as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(frequency_hz: f64, amplitude: f64, samples: usize) -> Vec<i16> {
        (0..samples)
            .map(|index| {
                let phase = 2.0 * std::f64::consts::PI * frequency_hz * index as f64 / 48_000.0;
                (amplitude * phase.sin()).round() as i16
            })
            .collect()
    }

    fn peak(samples: &[i16]) -> i32 {
        samples
            .iter()
            .map(|s| i32::from(*s).abs())
            .max()
            .unwrap_or(0)
    }

    #[test]
    fn taps_have_unit_dc_gain_and_are_symmetric() {
        let taps = design_taps();
        let sum: f32 = taps.iter().sum();
        assert!((sum - 1.0).abs() < 1e-5);
        for index in 0..TAP_COUNT / 2 {
            assert!((taps[index] - taps[TAP_COUNT - 1 - index]).abs() < 1e-7);
        }
    }

    #[test]
    fn constant_input_passes_unchanged_after_warm_up() {
        let mut decimator = Decimator::new();
        let output = decimator.process(&vec![1_000_i16; 600]);
        let settled = &output[TAP_COUNT / DECIMATION..];
        assert!(settled.iter().all(|s| (i32::from(*s) - 1_000).abs() <= 2));
    }

    #[test]
    fn speech_band_tone_keeps_its_amplitude() {
        let mut decimator = Decimator::new();
        let output = decimator.process(&sine(1_000.0, 8_000.0, 48_000));
        let settled = &output[TAP_COUNT..];
        let level = peak(settled);
        assert!((level - 8_000).abs() <= 240, "1 kHz peak was {level}");
    }

    #[test]
    fn tone_above_the_new_nyquist_is_removed_before_decimation() {
        let mut decimator = Decimator::new();
        let output = decimator.process(&sine(10_000.0, 8_000.0, 48_000));
        let settled = &output[TAP_COUNT..];
        assert!(peak(settled) < 240, "10 kHz leaked: {}", peak(settled));
    }

    #[test]
    fn output_does_not_depend_on_how_the_input_is_chunked() {
        let mut state = 12_345_u32;
        let signal: Vec<i16> = (0..5_000)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 16) as i16
            })
            .collect();
        let whole = Decimator::new().process(&signal);
        let sizes = [1_usize, 7, 960, 13, 2, 500];
        let mut decimator = Decimator::new();
        let mut chunked = Vec::new();
        let mut offset = 0;
        let mut turn = 0;
        while offset < signal.len() {
            let size = sizes[turn % sizes.len()].min(signal.len() - offset);
            chunked.extend(decimator.process(&signal[offset..offset + size]));
            offset += size;
            turn += 1;
        }
        assert_eq!(chunked, whole);
    }

    #[test]
    fn output_length_counts_every_third_input_across_chunks() {
        let mut decimator = Decimator::new();
        let mut total = 0;
        for chunk in [vec![0_i16; 1], vec![0_i16; 999]] {
            total += decimator.process(&chunk).len();
        }
        assert_eq!(total, 334);
    }

    #[test]
    fn full_scale_input_saturates_without_wrapping() {
        let mut decimator = Decimator::new();
        let output = decimator.process(&vec![i16::MAX; 300]);
        let last = *output.last().expect("output");
        assert!(last >= 32_700, "saturated value was {last}");
    }
}
