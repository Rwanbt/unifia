// SPDX-License-Identifier: MIT

//! Parakeet behind the shared speech contract. The engine stays private: callers
//! see `SpeechToText`, and loading remains an explicit, engine-specific step.

use std::sync::{Mutex, MutexGuard};

use unifia_speech_api::{
    AudioChunk, AudioFormat, SpeechError, SpeechToText, SttCapabilities, Transcript,
};

use crate::ParakeetEngine;

/// Languages of the app's speech contract that Parakeet serves.
const LANGUAGES: &[&str] = &["en", "fr", "de", "es", "it"];

/// Parakeet rejects utterances longer than one minute.
const MAX_UTTERANCE_MS: u32 = 60_000;

const PCM16_FULL_SCALE: f32 = 32_768.0;

pub struct ParakeetRecognizer {
    engine: Mutex<ParakeetEngine>,
}

impl ParakeetRecognizer {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(ParakeetEngine::new()),
        }
    }

    /// Replaces the engine with one that has finished loading its models.
    pub fn install(&self, engine: ParakeetEngine) {
        *self.lock() = engine;
    }

    pub fn is_loaded(&self) -> bool {
        self.lock().is_loaded()
    }

    /// Transcribes 16 kHz mono samples normalised to `-1.0..=1.0`.
    pub fn transcribe_samples(&self, samples: &[f32]) -> Result<String, String> {
        self.lock().transcribe(samples)
    }

    fn lock(&self) -> MutexGuard<'_, ParakeetEngine> {
        self.engine
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for ParakeetRecognizer {
    fn default() -> Self {
        Self::new()
    }
}

impl SpeechToText for ParakeetRecognizer {
    fn capabilities(&self) -> SttCapabilities {
        SttCapabilities {
            languages: LANGUAGES,
            streaming: false,
            max_utterance_ms: MAX_UTTERANCE_MS,
        }
    }

    fn transcribe(&self, audio: &AudioChunk) -> Result<Transcript, SpeechError> {
        if audio.format != AudioFormat::PCM16_MONO_16K {
            return Err(SpeechError::UnsupportedFormat);
        }
        if !self.is_loaded() {
            return Err(SpeechError::ModelMissing);
        }
        let samples: Vec<f32> = audio
            .samples
            .iter()
            .map(|sample| f32::from(*sample) / PCM16_FULL_SCALE)
            .collect();
        let text = self.transcribe_samples(&samples).map_err(|error| {
            tracing::warn!("[STT] Parakeet inference failed: {error}");
            SpeechError::Inference
        })?;
        Ok(Transcript {
            text,
            language: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_format_the_engine_does_not_take_is_refused_before_anything_else() {
        let recognizer = ParakeetRecognizer::new();
        let audio = AudioChunk::new(
            vec![0; 16],
            AudioFormat {
                sample_rate: 44_100,
                channels: 2,
            },
        );
        assert_eq!(
            recognizer.transcribe(&audio),
            Err(SpeechError::UnsupportedFormat)
        );
    }

    #[test]
    fn an_engine_without_models_reports_the_model_as_missing() {
        let recognizer = ParakeetRecognizer::new();
        let audio = AudioChunk::silence_ms(300);
        assert_eq!(
            recognizer.transcribe(&audio),
            Err(SpeechError::ModelMissing)
        );
    }

    #[test]
    fn capabilities_advertise_the_contract_languages_and_the_one_minute_cap() {
        let capabilities = ParakeetRecognizer::new().capabilities();
        assert!(capabilities.languages.contains(&"fr"));
        assert!(!capabilities.streaming);
        assert_eq!(capabilities.max_utterance_ms, 60_000);
    }
}
