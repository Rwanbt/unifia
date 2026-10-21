// SPDX-License-Identifier: MIT
//! Explicit VAD mode and its fallback cause.
//!
//! Silero is the reference detector. When it cannot produce a probability the
//! capture path falls back to RMS. That fallback used to be implicit — an
//! `Option` plus a boolean — so nothing recorded why it happened, and nothing
//! guaranteed a single log line per switch.
//!
//! This state machine is pure: it owns the mode, records the cause, and returns
//! it exactly once, on the transition. The caller logs that return value, so a
//! flapping detector cannot flood the log.

/// Detector actually driving the capture path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VadMode {
    Silero,
    Rms,
}

impl VadMode {
    pub(crate) fn code(self) -> &'static str {
        match self {
            VadMode::Silero => "silero",
            VadMode::Rms => "rms",
        }
    }
}

/// Why the capture path is not using Silero.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VadCause {
    /// The model could not be loaded at session start.
    ModelUnavailable,
    /// Inference failed while the session was running.
    InferenceFailed,
    /// Inference succeeded but returned no probability for the captured audio.
    ProbabilityMissing,
}

impl VadCause {
    pub(crate) fn code(self) -> &'static str {
        match self {
            VadCause::ModelUnavailable => "model-unavailable",
            VadCause::InferenceFailed => "inference-failed",
            VadCause::ProbabilityMissing => "probability-missing",
        }
    }
}

/// Mode of one capture session and the cause of its fallback, if any.
#[derive(Debug)]
pub(crate) struct VadModeState {
    mode: VadMode,
    cause: Option<VadCause>,
}

impl VadModeState {
    pub(crate) fn new(silero_loaded: bool) -> Self {
        Self {
            mode: if silero_loaded { VadMode::Silero } else { VadMode::Rms },
            cause: if silero_loaded {
                None
            } else {
                Some(VadCause::ModelUnavailable)
            },
        }
    }

    pub(crate) fn mode(&self) -> VadMode {
        self.mode
    }

    pub(crate) fn cause(&self) -> Option<VadCause> {
        self.cause
    }

    /// Records that Silero could not drive this poll. Returns the cause exactly
    /// once, when the mode switches; `None` while Silero is healthy or once the
    /// fallback is already active.
    pub(crate) fn observe(&mut self, cause: VadCause) -> Option<VadCause> {
        if self.mode == VadMode::Rms {
            return None;
        }
        self.mode = VadMode::Rms;
        self.cause = Some(cause);
        Some(cause)
    }
}

#[cfg(test)]
mod tests {
    use super::{VadCause, VadMode, VadModeState};

    #[test]
    fn a_loaded_model_starts_in_silero_without_a_cause() {
        let state = VadModeState::new(true);
        assert_eq!(state.mode(), VadMode::Silero);
        assert_eq!(state.cause(), None);
        assert_eq!(state.mode().code(), "silero");
    }

    #[test]
    fn a_missing_model_starts_in_rms_with_the_load_cause() {
        let state = VadModeState::new(false);
        assert_eq!(state.mode(), VadMode::Rms);
        assert_eq!(state.cause(), Some(VadCause::ModelUnavailable));
        assert_eq!(VadCause::ModelUnavailable.code(), "model-unavailable");
    }

    #[test]
    fn an_inference_failure_switches_once_and_keeps_the_cause() {
        let mut state = VadModeState::new(true);
        assert_eq!(
            state.observe(VadCause::InferenceFailed),
            Some(VadCause::InferenceFailed)
        );
        assert_eq!(state.mode(), VadMode::Rms);
        assert_eq!(state.cause(), Some(VadCause::InferenceFailed));
        assert_eq!(state.observe(VadCause::ProbabilityMissing), None);
    }

    #[test]
    fn a_missing_probability_switches_once_with_its_own_cause() {
        let mut state = VadModeState::new(true);
        assert_eq!(
            state.observe(VadCause::ProbabilityMissing),
            Some(VadCause::ProbabilityMissing)
        );
        assert_eq!(VadCause::ProbabilityMissing.code(), "probability-missing");
        assert_eq!(state.observe(VadCause::InferenceFailed), None);
    }

    #[test]
    fn an_rms_session_never_reports_a_transition() {
        let mut state = VadModeState::new(false);
        assert_eq!(state.observe(VadCause::InferenceFailed), None);
        assert_eq!(state.observe(VadCause::ProbabilityMissing), None);
        assert_eq!(state.mode(), VadMode::Rms);
        assert_eq!(state.mode().code(), "rms");
    }
}
