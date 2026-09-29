use std::path::Path;

pub(crate) const SPEECH_SAMPLE_RATE: u32 = 24_000;

pub(crate) fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == 0 || to_rate == 0 {
        return Vec::new();
    }
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let output_length =
        (samples.len() as u128 * u128::from(to_rate) / u128::from(from_rate)) as usize;
    let ratio = f64::from(from_rate) / f64::from(to_rate);
    (0..output_length)
        .map(|index| {
            let source_index = index as f64 * ratio;
            let lower_index = source_index as usize;
            let upper_index = (lower_index + 1).min(samples.len() - 1);
            let fraction = (source_index - lower_index as f64) as f32;
            samples[lower_index] * (1.0 - fraction) + samples[upper_index] * fraction
        })
        .collect()
}

pub(crate) fn write_wav(path: &Path, sample_rate: u32, samples: &[f32]) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|error| format!("Create WAV: {error}"))?;
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        writer
            .write_sample(value)
            .map_err(|error| format!("Write WAV: {error}"))?;
    }
    writer
        .finalize()
        .map_err(|error| format!("Finalize WAV: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_preserves_samples_when_rates_match() {
        let samples = [0.25, -0.5, 0.75];
        assert_eq!(
            resample(&samples, SPEECH_SAMPLE_RATE, SPEECH_SAMPLE_RATE),
            samples
        );
    }

    #[test]
    fn resample_converts_piper_rate_to_speech_rate() {
        let samples = vec![0.25; 22_050];
        let converted = resample(&samples, 22_050, SPEECH_SAMPLE_RATE);
        assert_eq!(converted.len(), 24_000);
        assert!(
            converted
                .iter()
                .all(|sample| (*sample - 0.25).abs() < f32::EPSILON)
        );
    }

    #[test]
    fn resample_handles_empty_audio_and_zero_rates() {
        assert!(resample(&[], 22_050, SPEECH_SAMPLE_RATE).is_empty());
        assert!(resample(&[0.5], 0, SPEECH_SAMPLE_RATE).is_empty());
    }
}
