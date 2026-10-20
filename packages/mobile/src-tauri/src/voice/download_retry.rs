// SPDX-License-Identifier: MIT

//! Retry policy for the background Parakeet download. Pure and deterministic:
//! the delays are a fixed table, so the schedule is verified without a clock.

/// Total attempts, the first one included.
pub(crate) const MAX_ATTEMPTS: u32 = 4;

/// Seconds to wait before the given attempt (1-based). The first attempt runs
/// at once; later attempts back off so a flaky network is not hammered.
pub(crate) fn delay_before_attempt(attempt: u32) -> Option<u64> {
    match attempt {
        2 => Some(5),
        3 => Some(20),
        4 => Some(60),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_attempt_runs_immediately() {
        assert_eq!(delay_before_attempt(1), None);
    }

    #[test]
    fn later_attempts_wait_with_a_fixed_schedule() {
        assert_eq!(delay_before_attempt(2), Some(5));
        assert_eq!(delay_before_attempt(3), Some(20));
        assert_eq!(delay_before_attempt(4), Some(60));
    }

    #[test]
    fn no_attempt_beyond_the_maximum_is_scheduled() {
        assert_eq!(delay_before_attempt(MAX_ATTEMPTS + 1), None);
        assert_eq!(delay_before_attempt(0), None);
    }

    #[test]
    fn delays_strictly_increase_across_all_attempts() {
        let delays: Vec<u64> = (2..=MAX_ATTEMPTS)
            .filter_map(delay_before_attempt)
            .collect();
        assert_eq!(delays.len() as u32, MAX_ATTEMPTS - 1);
        assert!(delays.windows(2).all(|pair| pair[0] < pair[1]));
    }
}
