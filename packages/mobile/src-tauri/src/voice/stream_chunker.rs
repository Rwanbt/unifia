// SPDX-License-Identifier: MIT

//! Splits a continuous dictation into segments the batch Parakeet encoder can
//! transcribe in bounded time. Parakeet TDT has no streaming encoder, so long
//! input is decoded piece by piece; this module only decides where a piece
//! ends and how much audio the next piece repeats at its head.
//!
//! Invariant, verified by test: for every segment, dropping its `overlap`
//! leading samples and concatenating the rest rebuilds the pushed audio
//! exactly. No speech is lost and nothing is decoded twice.

pub(crate) const SAMPLE_RATE_HZ: usize = 16_000;
/// A chunk may only end on silence once it holds this much audio.
pub(crate) const MIN_CHUNK_MS: u32 = 15_000;
/// Continuous silence that ends a chunk.
pub(crate) const SILENCE_MS: u32 = 700;
/// Hard limit: quality degrades and memory must stay bounded.
pub(crate) const MAX_CHUNK_MS: u32 = 60_000;
/// Audio repeated after a forced cut, so a word straddling the cut is decoded
/// whole in both segments and removed once by the seam merge.
pub(crate) const OVERLAP_MS: u32 = 1_000;

const fn samples(ms: u32) -> usize {
    (SAMPLE_RATE_HZ * ms as usize) / 1000
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Segment {
    pub(crate) samples: Vec<i16>,
    /// Leading samples that repeat the previous segment's tail; the consumer
    /// drops them before transcription.
    pub(crate) overlap: usize,
}

/// Mean amplitude below which a block counts as silence (about -44 dBFS), the
/// gate the final pass uses when no live voice-activity decision is available.
pub(crate) const SILENCE_MEAN: i64 = 200;

pub(crate) fn has_energy(block: &[i16]) -> bool {
    if block.is_empty() {
        return false;
    }
    let total: i64 = block.iter().map(|sample| i64::from(sample.abs())).sum();
    total / block.len() as i64 >= SILENCE_MEAN
}

/// Cuts an already recorded dictation. Used by the final pass, where the
/// per-block voice decision is derived from the audio itself.
pub(crate) fn split(samples: &[i16]) -> Vec<Segment> {
    let mut chunker = Chunker::new();
    let mut segments = Vec::new();
    for block in samples.chunks(960) {
        if let Some(segment) = chunker.push(block, has_energy(block)) {
            segments.push(segment);
        }
    }
    segments.extend(chunker.finish());
    segments
}

#[derive(Debug, Default)]
pub(crate) struct Chunker {
    pending: Vec<i16>,
    /// Leading samples of `pending` that already ended the previous segment.
    pending_overlap: usize,
    silence_run: usize,
}

impl Chunker {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Appends one capture block. `voiced` is the voice-activity decision for
    /// that whole block. Returns a segment when one is complete.
    pub(crate) fn push(&mut self, block: &[i16], voiced: bool) -> Option<Segment> {
        self.pending.extend_from_slice(block);
        self.silence_run = if voiced {
            0
        } else {
            self.silence_run + block.len()
        };

        if self.pending.len() >= samples(MAX_CHUNK_MS) {
            return Some(self.cut(samples(MAX_CHUNK_MS), samples(OVERLAP_MS), 0));
        }
        if self.pending.len() >= samples(MIN_CHUNK_MS) && self.silence_run >= samples(SILENCE_MS) {
            let end = self.pending.len() - self.silence_run;
            // An all-silent chunk has nothing to decode.
            if end > self.pending_overlap {
                let silence = self.pending.len() - end;
                return Some(self.cut(end, 0, silence));
            }
        }
        None
    }

    /// Returns the last segment of a finished dictation, if any audio remains.
    pub(crate) fn finish(&mut self) -> Option<Segment> {
        if self.pending.len() <= self.pending_overlap {
            self.pending.clear();
            self.pending_overlap = 0;
            return None;
        }
        let overlap = self.pending_overlap;
        let emitted = std::mem::take(&mut self.pending);
        self.pending_overlap = 0;
        self.silence_run = 0;
        Some(Segment {
            samples: emitted,
            overlap,
        })
    }

    /// Emits `pending[..end]`, keeps `keep` trailing samples of that emission
    /// at the head of the next segment, and re-queues whatever followed.
    fn cut(&mut self, end: usize, keep: usize, silence_after: usize) -> Segment {
        let overlap = self.pending_overlap;
        let rest = self.pending.split_off(end);
        let emitted = std::mem::take(&mut self.pending);
        let mut next = if keep > 0 {
            emitted[emitted.len() - keep..].to_vec()
        } else {
            Vec::new()
        };
        next.extend_from_slice(&rest);
        self.pending = next;
        self.pending_overlap = keep;
        self.silence_run = silence_after;
        Segment {
            samples: emitted,
            overlap,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voiced_chunk(chunker: &mut Chunker, total: usize, block: usize) -> Vec<Segment> {
        let mut out = Vec::new();
        let mut left = total;
        while left > 0 {
            let size = block.min(left);
            if let Some(segment) = chunker.push(&vec![7_i16; size], true) {
                out.push(segment);
            }
            left -= size;
        }
        out
    }

    #[test]
    fn no_cut_before_the_minimum_duration() {
        let mut chunker = Chunker::new();
        assert!(voiced_chunk(&mut chunker, samples(MIN_CHUNK_MS) - 1, 960).is_empty());
    }

    #[test]
    fn silence_cuts_a_chunk_that_reached_the_minimum_duration() {
        let mut chunker = Chunker::new();
        assert!(voiced_chunk(&mut chunker, samples(MIN_CHUNK_MS), 960).is_empty());
        let mut cut = None;
        for _ in 0..40 {
            if let Some(segment) = chunker.push(&vec![0_i16; 320], false) {
                cut = Some(segment);
                break;
            }
        }
        let segment = cut.expect("silence closes the chunk");
        assert_eq!(segment.overlap, 0, "a silence cut needs no overlap");
        assert_eq!(segment.samples.len(), samples(MIN_CHUNK_MS));
    }

    #[test]
    fn silence_before_the_minimum_never_cuts() {
        let mut chunker = Chunker::new();
        voiced_chunk(
            &mut chunker,
            samples(MIN_CHUNK_MS) - samples(SILENCE_MS) - 100,
            960,
        );
        assert!(chunker
            .push(&vec![0_i16; samples(SILENCE_MS)], false)
            .is_none());
    }

    #[test]
    fn a_long_utterance_is_cut_exactly_at_the_hard_limit() {
        let mut chunker = Chunker::new();
        let segments = voiced_chunk(&mut chunker, samples(MAX_CHUNK_MS) + samples(500), 960);
        let first = segments.first().expect("forced cut");
        assert_eq!(first.samples.len(), samples(MAX_CHUNK_MS));
        assert_eq!(first.overlap, 0);
        let second = chunker.finish().expect("tail after the forced cut");
        assert_eq!(second.overlap, samples(OVERLAP_MS));
    }

    #[test]
    fn overlap_repeats_the_tail_of_the_previous_segment() {
        let mut chunker = Chunker::new();
        let mut segments = voiced_chunk(&mut chunker, samples(MAX_CHUNK_MS) + samples(500), 960);
        segments.extend(chunker.finish());
        let first = &segments[0];
        let second = &segments[1];
        let tail = &first.samples[first.samples.len() - second.overlap..];
        assert_eq!(tail, &second.samples[..second.overlap]);
    }

    fn rebuild(segments: &[Segment]) -> Vec<i16> {
        segments
            .iter()
            .flat_map(|segment| segment.samples[segment.overlap..].iter().copied())
            .collect()
    }

    fn signal(len: usize) -> Vec<i16> {
        (0..len).map(|index| (index % 30_000) as i16).collect()
    }

    #[test]
    fn dropping_the_overlap_rebuilds_the_input_exactly() {
        for total in [
            samples(MIN_CHUNK_MS),
            samples(MAX_CHUNK_MS) + samples(2_000),
            samples(90_000),
        ] {
            let input = signal(total);
            let mut chunker = Chunker::new();
            let mut segments = Vec::new();
            for block in input.chunks(960) {
                if let Some(segment) = chunker.push(block, true) {
                    segments.push(segment);
                }
            }
            if let Some(segment) = chunker.finish() {
                segments.push(segment);
            }
            assert_eq!(rebuild(&segments), input, "total {total}");
        }
    }

    #[test]
    fn mixed_voice_and_silence_rebuilds_the_input_exactly() {
        let mut chunker = Chunker::new();
        let mut input = Vec::new();
        let mut segments = Vec::new();
        for round in 0..5 {
            let speech = signal(samples(MIN_CHUNK_MS) + round * 1_000);
            input.extend_from_slice(&speech);
            for block in speech.chunks(960) {
                if let Some(segment) = chunker.push(block, true) {
                    segments.push(segment);
                }
            }
            let pause = vec![0_i16; samples(SILENCE_MS) + 10];
            input.extend_from_slice(&pause);
            for block in pause.chunks(960) {
                if let Some(segment) = chunker.push(block, false) {
                    segments.push(segment);
                }
            }
        }
        if let Some(tail) = chunker.finish() {
            segments.push(tail);
        }
        assert!(segments.len() >= 5, "each pause closes a chunk");
        assert_eq!(rebuild(&segments), input);
    }

    #[test]
    fn finish_returns_the_tail_without_repeating_it() {
        let mut chunker = Chunker::new();
        let spoken = signal(samples(3_000));
        assert!(chunker.push(&spoken, true).is_none());
        let tail = chunker.finish().expect("tail");
        assert_eq!(tail.overlap, 0);
        assert_eq!(tail.samples, spoken);
        assert!(chunker.finish().is_none(), "a finished chunker stays empty");
    }

    #[test]
    fn finish_after_a_forced_cut_marks_the_overlap() {
        let mut chunker = Chunker::new();
        voiced_chunk(&mut chunker, samples(MAX_CHUNK_MS) + 100, 960);
        let tail = chunker.finish().expect("tail");
        assert_eq!(tail.overlap, samples(OVERLAP_MS));
        assert_eq!(tail.samples.len(), samples(OVERLAP_MS) + 100);
    }

    #[test]
    fn energy_separates_speech_from_silence() {
        assert!(has_energy(&[1_000, -1_000]));
        assert!(!has_energy(&[10, -20, 30]));
        assert!(!has_energy(&[]));
    }

    #[test]
    fn a_short_dictation_is_one_segment() {
        let input = signal(samples(5_000));
        let segments = split(&input);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].overlap, 0);
        assert_eq!(rebuild(&segments), input);
    }

    #[test]
    fn a_pause_splits_a_recorded_dictation_without_losing_audio() {
        let mut input = signal(samples(16_000));
        input.extend_from_slice(&vec![0_i16; samples(1_500)]);
        input.extend(signal(samples(4_000)));
        let segments = split(&input);
        assert_eq!(segments.len(), 2, "the pause ends the first segment");
        assert!(segments.iter().all(|segment| segment.overlap == 0));
        assert_eq!(rebuild(&segments), input);
    }

    #[test]
    fn empty_blocks_are_harmless() {
        let mut chunker = Chunker::new();
        assert!(chunker.push(&[], true).is_none());
        assert!(chunker.finish().is_none());
    }
}
