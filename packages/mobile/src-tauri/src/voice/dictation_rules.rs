// SPDX-License-Identifier: MIT

//! Pure rules for the single shared audio session: who owns it, and what a
//! dictation may keep. No Tauri or Oboe types here, so every rule is tested
//! deterministically on the host.

pub(crate) const SAMPLE_RATE_HZ: usize = 16_000;
pub(crate) const MIN_DICTATION_SAMPLES: usize = SAMPLE_RATE_HZ / 5;
pub(crate) const MAX_DICTATION_SAMPLES: usize = SAMPLE_RATE_HZ * 60;
pub(crate) const LIVE_ACTIVE: &str = "Live est actif : la dictée est indisponible";
pub(crate) const DICTATION_ACTIVE: &str = "Une dictée est en cours : Live ne peut pas démarrer";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Owner {
    Live,
    Dictation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Entry {
    /// No session exists: open one for the requester.
    Open(Owner),
    /// The requester already owns the session: nothing to do.
    Attach,
    /// The other feature owns the session: the request is refused.
    Refuse(&'static str),
}

pub(crate) fn start_dictation(current: Option<Owner>) -> Entry {
    match current {
        None => Entry::Open(Owner::Dictation),
        Some(Owner::Dictation) => Entry::Attach,
        Some(Owner::Live) => Entry::Refuse(LIVE_ACTIVE),
    }
}

pub(crate) fn open_live(current: Option<Owner>) -> Entry {
    match current {
        None => Entry::Open(Owner::Live),
        Some(Owner::Live) => Entry::Attach,
        Some(Owner::Dictation) => Entry::Refuse(DICTATION_ACTIVE),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Close {
    /// No session exists: nothing to close.
    Nothing,
    /// Live owns the session: close it.
    Close,
    /// A dictation owns the session: closing would drop its audio, so it is refused.
    Refuse(&'static str),
}

pub(crate) fn close_session(current: Option<Owner>) -> Close {
    match current {
        None => Close::Nothing,
        Some(Owner::Live) => Close::Close,
        Some(Owner::Dictation) => Close::Refuse(DICTATION_ACTIVE),
    }
}

/// Dictation audio, capped at [`MAX_DICTATION_SAMPLES`]. Once full, the
/// capture ends: the first minute is kept and nothing is dropped before it.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct DictationBuffer {
    samples: Vec<i16>,
}

impl DictationBuffer {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Appends as much of `chunk` as fits, in order, and reports whether the
    /// cap has been reached.
    pub(crate) fn push(&mut self, chunk: &[i16]) -> bool {
        let room = MAX_DICTATION_SAMPLES.saturating_sub(self.samples.len());
        self.samples
            .extend_from_slice(&chunk[..chunk.len().min(room)]);
        self.is_full()
    }

    pub(crate) fn is_full(&self) -> bool {
        self.samples.len() >= MAX_DICTATION_SAMPLES
    }

    pub(crate) fn len(&self) -> usize {
        self.samples.len()
    }

    pub(crate) fn is_too_short(&self) -> bool {
        self.len() < MIN_DICTATION_SAMPLES
    }

    pub(crate) fn into_samples(self) -> Vec<i16> {
        self.samples
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dictation_starts_when_nothing_is_open() {
        assert_eq!(start_dictation(None), Entry::Open(Owner::Dictation));
    }

    #[test]
    fn dictation_is_refused_while_live_is_active() {
        assert_eq!(
            start_dictation(Some(Owner::Live)),
            Entry::Refuse(LIVE_ACTIVE)
        );
    }

    #[test]
    fn repeated_dictation_start_attaches_to_its_own_session() {
        assert_eq!(start_dictation(Some(Owner::Dictation)), Entry::Attach);
    }

    #[test]
    fn live_starts_when_nothing_is_open() {
        assert_eq!(open_live(None), Entry::Open(Owner::Live));
    }

    #[test]
    fn live_is_refused_while_a_dictation_records() {
        assert_eq!(
            open_live(Some(Owner::Dictation)),
            Entry::Refuse(DICTATION_ACTIVE)
        );
    }

    #[test]
    fn repeated_live_open_attaches() {
        assert_eq!(open_live(Some(Owner::Live)), Entry::Attach);
    }

    #[test]
    fn closing_with_no_session_does_nothing() {
        assert_eq!(close_session(None), Close::Nothing);
    }

    #[test]
    fn live_can_close_its_own_session() {
        assert_eq!(close_session(Some(Owner::Live)), Close::Close);
    }

    #[test]
    fn closing_is_refused_while_a_dictation_records() {
        assert_eq!(
            close_session(Some(Owner::Dictation)),
            Close::Refuse(DICTATION_ACTIVE)
        );
    }

    #[test]
    fn buffer_keeps_every_sample_below_the_cap() {
        let mut buffer = DictationBuffer::new();
        assert!(!buffer.push(&[1, 2, 3]));
        assert!(!buffer.push(&[4]));
        assert_eq!(buffer.into_samples(), vec![1, 2, 3, 4]);
    }

    #[test]
    fn buffer_stops_exactly_at_one_minute() {
        let mut buffer = DictationBuffer::new();
        let almost = vec![7_i16; MAX_DICTATION_SAMPLES - 1];
        assert!(!buffer.push(&almost));
        assert!(!buffer.is_full());
        assert!(buffer.push(&[9, 9, 9]));
        assert_eq!(buffer.len(), MAX_DICTATION_SAMPLES);
        let kept = buffer.into_samples();
        assert_eq!(kept.len(), MAX_DICTATION_SAMPLES);
        assert_eq!(kept.last(), Some(&9));
    }

    #[test]
    fn buffer_ignores_audio_pushed_after_the_cap() {
        let mut buffer = DictationBuffer::new();
        buffer.push(&vec![1_i16; MAX_DICTATION_SAMPLES]);
        assert!(buffer.push(&[2, 2]));
        assert_eq!(buffer.len(), MAX_DICTATION_SAMPLES);
    }

    #[test]
    fn minimum_length_is_a_fifth_of_a_second() {
        let mut short = DictationBuffer::new();
        short.push(&vec![0_i16; MIN_DICTATION_SAMPLES - 1]);
        assert!(short.is_too_short());
        let mut enough = DictationBuffer::new();
        enough.push(&vec![0_i16; MIN_DICTATION_SAMPLES]);
        assert!(!enough.is_too_short());
    }
}
