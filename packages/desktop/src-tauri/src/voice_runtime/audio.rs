use std::path::Path;

pub(super) fn write_wav(path: &Path, sample_rate: u32, samples: &[f32]) -> Result<(), String> {
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
