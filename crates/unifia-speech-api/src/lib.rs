// SPDX-License-Identifier: MIT

//! Provider-neutral speech contracts.
//!
//! The application talks to a recognizer and a synthesizer through these
//! traits, never through a concrete engine. Swapping Parakeet for another
//! recognizer, or Pocket for another synthesizer, is then an assembly choice
//! in the runtime instead of an edit across the call sites.
//!
//! Errors are typed on purpose. A `String` message cannot be told apart from
//! another one without matching text, which blocks interchangeability: every
//! engine would invent its own wording. `SpeechError::code` is the stable
//! value that crosses the IPC boundary and the logs.

use std::fmt;

/// Audio carried between the capture pipeline and an engine: signed 16-bit
/// samples, interleaved when there is more than one channel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioChunk {
    pub samples: Vec<i16>,
    pub format: AudioFormat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioFormat {
    /// The format both current engines consume and produce.
    pub const PCM16_MONO_16K: Self = Self {
        sample_rate: 16_000,
        channels: 1,
    };

    /// Samples per second of audio, whatever the channel count.
    pub const fn frames_per_second(&self) -> u32 {
        self.sample_rate * self.channels as u32
    }

    pub fn duration_ms(&self, samples: usize) -> u64 {
        let fps = self.frames_per_second().max(1) as u64;
        samples as u64 * 1000 / fps
    }
}

impl AudioChunk {
    pub fn new(samples: Vec<i16>, format: AudioFormat) -> Self {
        Self { samples, format }
    }

    pub fn silence_ms(ms: u64) -> Self {
        let frames = (AudioFormat::PCM16_MONO_16K.frames_per_second() as u64 * ms / 1000) as usize;
        Self::new(vec![0; frames], AudioFormat::PCM16_MONO_16K)
    }

    pub fn duration_ms(&self) -> u64 {
        self.format.duration_ms(self.samples.len())
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SttCapabilities {
    /// Languages the engine was trained for, as BCP-47 primary tags.
    pub languages: &'static [&'static str],
    /// True when the engine can emit partial results while audio arrives.
    pub streaming: bool,
    /// Longest utterance the engine accepts, in milliseconds. Zero means no limit.
    pub max_utterance_ms: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transcript {
    pub text: String,
    /// Language the engine recognised, when it reports one.
    pub language: Option<String>,
}

impl Transcript {
    pub fn empty() -> Self {
        Self {
            text: String::new(),
            language: None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SynthesisRequest<'a> {
    pub text: &'a str,
    pub language: &'a str,
    pub voice: Option<&'a str>,
    pub speed: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TtsCapabilities {
    pub languages: &'static [&'static str],
    /// True when `open` can be consumed chunk by chunk as audio is produced.
    pub streaming: bool,
    pub sample_rate: u32,
}

/// A recognizer. Implementations are shared across threads because the capture
/// thread, the inference worker and the IPC commands all reach them.
pub trait SpeechToText: Send + Sync {
    fn capabilities(&self) -> SttCapabilities;
    /// Transcribes one utterance. The format is the engine's to accept; return
    /// `UnsupportedFormat` rather than silently resampling, so a caller cannot
    /// believe it was understood.
    fn transcribe(&self, audio: &AudioChunk) -> Result<Transcript, SpeechError>;
}

/// A synthesizer. `open` returns a stream so a caller can start playing before
/// the whole text has been rendered.
pub trait SpeechSynthesis: Send + Sync {
    fn capabilities(&self) -> TtsCapabilities;
    fn open(&self, request: SynthesisRequest<'_>) -> Result<Box<dyn SynthesisStream>, SpeechError>;
}

/// One utterance being synthesized. `next` returns `None` once, at the end.
pub trait SynthesisStream: Send {
    fn next(&mut self) -> Result<Option<AudioChunk>, SpeechError>;
    fn cancel(&mut self);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpeechError {
    /// No model is installed, or it is still downloading.
    ModelMissing,
    /// The installed files do not match their manifest.
    ModelCorrupt,
    /// The audio device or the shared session is held by another feature.
    AudioBusy,
    /// The engine does not serve that language.
    UnsupportedLanguage,
    /// The engine cannot accept that audio format.
    UnsupportedFormat,
    /// The engine is present but not usable right now.
    NotAvailable,
    /// The engine failed while working.
    Inference,
    /// The caller cancelled.
    Cancelled,
}

impl SpeechError {
    /// Stable token for logs and IPC. Never localised, never reworded.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::ModelMissing => "model_missing",
            Self::ModelCorrupt => "model_corrupt",
            Self::AudioBusy => "audio_busy",
            Self::UnsupportedLanguage => "unsupported_language",
            Self::UnsupportedFormat => "unsupported_format",
            Self::NotAvailable => "not_available",
            Self::Inference => "inference",
            Self::Cancelled => "cancelled",
        }
    }

    /// True when retrying later can succeed without a code or asset change.
    pub const fn is_transient(&self) -> bool {
        matches!(self, Self::AudioBusy | Self::NotAvailable | Self::Inference)
    }
}

impl fmt::Display for SpeechError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::ModelMissing => "speech model is not installed",
            Self::ModelCorrupt => "speech model failed verification",
            Self::AudioBusy => "audio is busy",
            Self::UnsupportedLanguage => "language is not supported by this engine",
            Self::UnsupportedFormat => "audio format is not supported by this engine",
            Self::NotAvailable => "speech engine is not available",
            Self::Inference => "speech inference failed",
            Self::Cancelled => "speech operation was cancelled",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for SpeechError {}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeStt;
    struct FakeTts;

    impl SpeechToText for FakeStt {
        fn capabilities(&self) -> SttCapabilities {
            SttCapabilities {
                languages: &["fr", "en"],
                streaming: false,
                max_utterance_ms: 60_000,
            }
        }

        fn transcribe(&self, audio: &AudioChunk) -> Result<Transcript, SpeechError> {
            if audio.format != AudioFormat::PCM16_MONO_16K {
                return Err(SpeechError::UnsupportedFormat);
            }
            Ok(Transcript {
                text: "bonjour".into(),
                language: Some("fr".into()),
            })
        }
    }

    struct FakeStream {
        chunks: Vec<AudioChunk>,
    }

    impl SynthesisStream for FakeStream {
        fn next(&mut self) -> Result<Option<AudioChunk>, SpeechError> {
            if self.chunks.is_empty() {
                return Ok(None);
            }
            Ok(Some(self.chunks.remove(0)))
        }

        fn cancel(&mut self) {
            self.chunks.clear();
        }
    }

    impl SpeechSynthesis for FakeTts {
        fn capabilities(&self) -> TtsCapabilities {
            TtsCapabilities {
                languages: &["fr"],
                streaming: true,
                sample_rate: 24_000,
            }
        }

        fn open(
            &self,
            request: SynthesisRequest<'_>,
        ) -> Result<Box<dyn SynthesisStream>, SpeechError> {
            if request.text.trim().is_empty() {
                return Err(SpeechError::Inference);
            }
            Ok(Box::new(FakeStream {
                chunks: vec![AudioChunk::silence_ms(20)],
            }))
        }
    }

    #[test]
    fn an_engine_is_usable_through_the_trait_object() {
        let stt: Box<dyn SpeechToText> = Box::new(FakeStt);
        assert_eq!(stt.capabilities().languages, &["fr", "en"]);
        let audio = AudioChunk::silence_ms(100);
        assert_eq!(stt.transcribe(&audio).expect("transcript").text, "bonjour");
    }

    #[test]
    fn a_mismatched_format_is_reported_not_silently_resampled() {
        let stt = FakeStt;
        let audio = AudioChunk::new(
            vec![0; 16],
            AudioFormat {
                sample_rate: 44_100,
                channels: 2,
            },
        );
        assert_eq!(stt.transcribe(&audio), Err(SpeechError::UnsupportedFormat));
    }

    #[test]
    fn a_stream_yields_chunks_then_ends_once() {
        let tts = FakeTts;
        let request = SynthesisRequest {
            text: "bonjour",
            language: "fr",
            voice: None,
            speed: 1.0,
        };
        let mut stream = tts.open(request).expect("stream");
        assert!(stream.next().expect("chunk").is_some());
        assert!(stream.next().expect("end").is_none());
    }

    #[test]
    fn cancelling_a_stream_discards_what_remains() {
        let tts = FakeTts;
        let request = SynthesisRequest {
            text: "bonjour",
            language: "fr",
            voice: None,
            speed: 1.0,
        };
        let mut stream = tts.open(request).expect("stream");
        stream.cancel();
        assert!(stream.next().expect("end").is_none());
    }

    #[test]
    fn error_codes_are_stable_and_unique() {
        let all = [
            SpeechError::ModelMissing,
            SpeechError::ModelCorrupt,
            SpeechError::AudioBusy,
            SpeechError::UnsupportedLanguage,
            SpeechError::UnsupportedFormat,
            SpeechError::NotAvailable,
            SpeechError::Inference,
            SpeechError::Cancelled,
        ];
        let mut codes: Vec<&str> = all.iter().map(SpeechError::code).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), all.len(), "two errors share a code");
    }

    #[test]
    fn only_temporary_conditions_are_transient() {
        assert!(SpeechError::AudioBusy.is_transient());
        assert!(SpeechError::Inference.is_transient());
        assert!(!SpeechError::ModelMissing.is_transient());
        assert!(!SpeechError::UnsupportedLanguage.is_transient());
    }

    #[test]
    fn chunk_duration_follows_the_format() {
        let chunk = AudioChunk::silence_ms(250);
        assert_eq!(chunk.duration_ms(), 250);
        assert_eq!(chunk.samples.len(), 4_000);
        let stereo = AudioFormat {
            sample_rate: 24_000,
            channels: 2,
        };
        assert_eq!(stereo.frames_per_second(), 48_000);
        assert_eq!(stereo.duration_ms(24_000), 500);
    }
}
