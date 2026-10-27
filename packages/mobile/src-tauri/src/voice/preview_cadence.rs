// SPDX-License-Identifier: MIT

//! When to decode a live preview of the running dictation. Parakeet has no
//! streaming encoder, so a preview is a full decode of a short window: the
//! first one is worth waiting a second for, and the cadence must back off
//! before it spends most of a core on a long recording.

pub(crate) const FIRST_TICK_MS: u64 = 1_000;
pub(crate) const TICK_MS: u64 = 2_000;
pub(crate) const TICK_LONG_MS: u64 = 10_000;
pub(crate) const BACKOFF_AFTER_MS: u64 = 15_000;
/// A preview decodes only this much recent audio.
pub(crate) const PREVIEW_WINDOW_MS: u64 = 10_000;

/// The audio position, in milliseconds, of the next preview. `0` means no
/// preview has been scheduled yet.
pub(crate) fn next_due(current: u64) -> u64 {
    match current {
        0 => FIRST_TICK_MS,
        tick if tick < BACKOFF_AFTER_MS => tick + TICK_MS,
        tick => tick + TICK_LONG_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_preview_waits_one_second_of_audio() {
        assert_eq!(next_due(0), 1_000);
    }

    #[test]
    fn the_cadence_is_two_seconds_until_fifteen() {
        let mut tick = 0;
        let mut seen = Vec::new();
        for _ in 0..8 {
            tick = next_due(tick);
            seen.push(tick);
        }
        assert_eq!(
            seen,
            vec![1_000, 3_000, 5_000, 7_000, 9_000, 11_000, 13_000, 15_000]
        );
    }

    #[test]
    fn a_preview_decodes_a_bounded_window() {
        assert_eq!(PREVIEW_WINDOW_MS, 10_000);
    }

    #[test]
    fn a_long_recording_backs_off_to_ten_seconds() {
        assert_eq!(next_due(15_000), 25_000);
        assert_eq!(next_due(25_000), 35_000);
    }

    #[test]
    fn the_schedule_is_strictly_increasing() {
        let mut tick = 0;
        for _ in 0..40 {
            let next = next_due(tick);
            assert!(next > tick, "{next} after {tick}");
            tick = next;
        }
    }
}
