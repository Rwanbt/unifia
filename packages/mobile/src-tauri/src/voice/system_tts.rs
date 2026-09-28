// SPDX-License-Identifier: MIT
//! Offline Android system text-to-speech as PCM, for the canonical TTS
//! router's `fallback-android-tts` backend (ADR-062: Pocket, then a validated
//! local fallback, then an explicit error).
//!
//! Kotlin (`SystemSpeechSynthesizer.kt`) renders the text with an installed,
//! network-free system voice into a WAV file in the app cache; this command
//! reads it back and returns the PCM as raw bytes, so audio reaches the
//! router — and from there Oboe or WebAudio — instead of the engine playing
//! it behind Voice's playback arbitration.

use std::path::Path;

/// Longest text one call may synthesise; the TypeScript backend sends one
/// sentence group at a time, far below this.
const MAX_TEXT_CHARS: usize = 4_000;

/// Response layout: sample rate as little-endian u32, then mono PCM16 LE.
fn encode_response(sample_rate: u32, samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + samples.len() * 2);
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

/// Reads a mono or multi-channel 16-bit WAV as mono PCM (first channel).
fn read_wav_mono(path: &Path) -> Result<(u32, Vec<i16>), String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| format!("SYSTEM_TTS_FAILED: unreadable WAV: {e}"))?;
    let spec = reader.spec();
    if spec.sample_format != hound::SampleFormat::Int || spec.bits_per_sample != 16 {
        return Err(format!(
            "SYSTEM_TTS_FAILED: unsupported WAV format {:?}/{} bits",
            spec.sample_format, spec.bits_per_sample
        ));
    }
    let channels = usize::from(spec.channels.max(1));
    let samples = reader
        .samples::<i16>()
        .step_by(channels)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("SYSTEM_TTS_FAILED: truncated WAV: {e}"))?;
    Ok((spec.sample_rate, samples))
}

#[cfg(target_os = "android")]
fn synthesize_to_file(text: &str, language: &str, rate: f32) -> Result<String, String> {
    use jni::objects::{JObject, JValue};

    let ctx = ndk_context::android_context();
    // SAFETY: ndk_context is populated by the Tauri/Android runtime before any
    // command runs; the VM and activity pointers stay valid for the process.
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("SYSTEM_TTS_UNAVAILABLE: JavaVM: {e:?}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("SYSTEM_TTS_UNAVAILABLE: attach: {e:?}"))?;
    // SAFETY: see above — the activity outlives this call.
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let text = env
        .new_string(text)
        .map_err(|e| format!("SYSTEM_TTS_FAILED: text: {e:?}"))?;
    let language = env
        .new_string(language)
        .map_err(|e| format!("SYSTEM_TTS_FAILED: language: {e:?}"))?;
    let result = env.call_method(
        &activity,
        "synthesizeSpeechToFile",
        "(Ljava/lang/String;Ljava/lang/String;F)Ljava/lang/String;",
        &[
            JValue::Object(&text),
            JValue::Object(&language),
            JValue::Float(rate),
        ],
    );
    // A pending Java exception can surface as Ok(null): read it first and keep
    // its message, which carries the classified SYSTEM_TTS_* prefix.
    if env.exception_check().unwrap_or(false) {
        let throwable = env
            .exception_occurred()
            .map_err(|e| format!("SYSTEM_TTS_FAILED: {e:?}"))?;
        let _ = env.exception_clear();
        let message = env
            .call_method(&throwable, "getMessage", "()Ljava/lang/String;", &[])
            .and_then(|value| value.l())
            .ok()
            .filter(|value| !value.is_null())
            .and_then(|value| env.get_string((&value).into()).ok().map(String::from))
            .unwrap_or_else(|| "SYSTEM_TTS_FAILED: the system engine threw".to_owned());
        return Err(message);
    }
    let path = result
        .map_err(|e| format!("SYSTEM_TTS_FAILED: {e:?}"))?
        .l()
        .map_err(|e| format!("SYSTEM_TTS_FAILED: {e:?}"))?;
    if path.is_null() {
        return Err("SYSTEM_TTS_FAILED: no output file".to_owned());
    }
    env.get_string((&path).into())
        .map(String::from)
        .map_err(|e| format!("SYSTEM_TTS_FAILED: output path: {e:?}"))
}

#[cfg(not(target_os = "android"))]
fn synthesize_to_file(_text: &str, _language: &str, _rate: f32) -> Result<String, String> {
    Err("SYSTEM_TTS_UNAVAILABLE: the system voice is Android-only".to_owned())
}

/// Synthesise `text` with an installed offline system voice for `language`
/// (BCP-47, e.g. "fr"). Returns `u32 LE sample rate || PCM16 LE mono`.
#[tauri::command]
pub async fn voice_tts_system_synthesize(
    text: String,
    language: String,
    rate: f32,
) -> Result<tauri::ipc::Response, String> {
    if text.trim().is_empty() {
        return Ok(tauri::ipc::Response::new(encode_response(0, &[])));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(format!(
            "SYSTEM_TTS_FAILED: text longer than {MAX_TEXT_CHARS} characters"
        ));
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let path = synthesize_to_file(&text, &language, rate)?;
        let decoded = read_wav_mono(Path::new(&path));
        if let Err(error) = std::fs::remove_file(&path) {
            log::warn!("[voice] could not delete system TTS output: {error}");
        }
        let (sample_rate, samples) = decoded?;
        Ok::<_, String>(encode_response(sample_rate, &samples))
    })
    .await
    .map_err(|e| format!("SYSTEM_TTS_FAILED: worker: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_is_rate_then_little_endian_pcm() {
        let bytes = encode_response(24_000, &[1, -2]);
        assert_eq!(bytes, vec![0xC0, 0x5D, 0, 0, 1, 0, 0xFE, 0xFF]);
    }

    #[test]
    fn stereo_wav_is_read_as_its_first_channel() {
        let path = std::env::temp_dir().join(format!("system-tts-test-{}.wav", std::process::id()));
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 22_050,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).expect("create WAV");
        for sample in [10_i16, 99, 20, 99, 30, 99] {
            writer.write_sample(sample).expect("write sample");
        }
        writer.finalize().expect("finalize WAV");

        let (rate, samples) = read_wav_mono(&path).expect("read WAV");
        std::fs::remove_file(&path).expect("remove WAV");
        assert_eq!(rate, 22_050);
        assert_eq!(samples, vec![10, 20, 30]);
    }

    #[test]
    fn a_missing_file_is_a_classified_failure() {
        let error = read_wav_mono(Path::new("definitely-missing.wav")).expect_err("missing file");
        assert!(error.starts_with("SYSTEM_TTS_FAILED"), "{error}");
    }
}
