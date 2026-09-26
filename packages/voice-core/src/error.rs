// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceErrorStage {
    AudioInput,
    AudioOutput,
    Permission,
    ModelMissing,
    ModelDownload,
    Integrity,
    ModelLoad,
    Vad,
    TurnDetection,
    Stt,
    Session,
    Provider,
    Llm,
    Tool,
    Tts,
    Resource,
    Thermal,
    Network,
    UnsupportedCapability,
    Abi,
    Logging,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceErrorCause {
    Permission,
    Device,
    Availability,
    Provider,
    Session,
    Network,
    Programmer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoiceErrorCode {
    #[serde(rename = "AUDIO_INPUT_UNAVAILABLE")]
    AudioInputUnavailable,
    #[serde(rename = "AUDIO_OUTPUT_UNAVAILABLE")]
    AudioOutputUnavailable,
    #[serde(rename = "PERMISSION_MICROPHONE_DENIED")]
    MicrophonePermissionDenied,
    #[serde(rename = "MODEL_MISSING_REQUIRED")]
    RequiredModelMissing,
    #[serde(rename = "MODEL_DOWNLOAD_FAILED")]
    ModelDownloadFailed,
    #[serde(rename = "INTEGRITY_VERIFICATION_FAILED")]
    IntegrityVerificationFailed,
    #[serde(rename = "MODEL_LOAD_FAILED")]
    ModelLoadFailed,
    #[serde(rename = "VAD_PROVIDER_UNAVAILABLE")]
    VadProviderUnavailable,
    #[serde(rename = "TURN_DETECTION_UNAVAILABLE")]
    TurnDetectionUnavailable,
    #[serde(rename = "STT_PROVIDER_UNAVAILABLE")]
    SttProviderUnavailable,
    #[serde(rename = "SESSION_AGENT_ERROR")]
    SessionAgentError,
    #[serde(rename = "SESSION_AGENT_UNAVAILABLE")]
    SessionAgentUnavailable,
    #[serde(rename = "PROVIDER_VOICE_HOST_UNAVAILABLE")]
    VoiceHostUnavailable,
    #[serde(rename = "PROVIDER_LAN_ACCESS_DISABLED")]
    VoiceHostLanDisabled,
    #[serde(rename = "PROVIDER_BINDING_INVALID")]
    ProviderBindingInvalid,
    #[serde(rename = "LLM_UNAVAILABLE")]
    LlmUnavailable,
    #[serde(rename = "TOOL_EXECUTION_FAILED")]
    ToolExecutionFailed,
    #[serde(rename = "TTS_PROVIDER_UNAVAILABLE")]
    TtsProviderUnavailable,
    #[serde(rename = "RESOURCE_PRESSURE")]
    ResourcePressure,
    #[serde(rename = "THERMAL_LIMIT")]
    ThermalLimit,
    #[serde(rename = "NETWORK_CONNECTION_LOST")]
    NetworkConnectionLost,
    #[serde(rename = "NETWORK_RATE_LIMITED")]
    NetworkRateLimited,
    #[serde(rename = "UNSUPPORTED_CAPABILITY_UNCLASSIFIED_RUNTIME_ERROR")]
    UnclassifiedRuntimeError,
    #[serde(rename = "ABI_UNSUPPORTED")]
    AbiUnsupported,
    #[serde(rename = "LOGGING_FAILURE")]
    LoggingFailure,
}

impl VoiceErrorCode {
    pub const ALL: [Self; 25] = [
        Self::AudioInputUnavailable,
        Self::AudioOutputUnavailable,
        Self::MicrophonePermissionDenied,
        Self::RequiredModelMissing,
        Self::ModelDownloadFailed,
        Self::IntegrityVerificationFailed,
        Self::ModelLoadFailed,
        Self::VadProviderUnavailable,
        Self::TurnDetectionUnavailable,
        Self::SttProviderUnavailable,
        Self::SessionAgentError,
        Self::SessionAgentUnavailable,
        Self::VoiceHostUnavailable,
        Self::VoiceHostLanDisabled,
        Self::ProviderBindingInvalid,
        Self::LlmUnavailable,
        Self::ToolExecutionFailed,
        Self::TtsProviderUnavailable,
        Self::ResourcePressure,
        Self::ThermalLimit,
        Self::NetworkConnectionLost,
        Self::NetworkRateLimited,
        Self::UnclassifiedRuntimeError,
        Self::AbiUnsupported,
        Self::LoggingFailure,
    ];

    pub const fn stage(self) -> VoiceErrorStage {
        match self {
            Self::AudioInputUnavailable => VoiceErrorStage::AudioInput,
            Self::AudioOutputUnavailable => VoiceErrorStage::AudioOutput,
            Self::MicrophonePermissionDenied => VoiceErrorStage::Permission,
            Self::RequiredModelMissing => VoiceErrorStage::ModelMissing,
            Self::ModelDownloadFailed => VoiceErrorStage::ModelDownload,
            Self::IntegrityVerificationFailed => VoiceErrorStage::Integrity,
            Self::ModelLoadFailed => VoiceErrorStage::ModelLoad,
            Self::VadProviderUnavailable => VoiceErrorStage::Vad,
            Self::TurnDetectionUnavailable => VoiceErrorStage::TurnDetection,
            Self::SttProviderUnavailable => VoiceErrorStage::Stt,
            Self::SessionAgentError | Self::SessionAgentUnavailable => VoiceErrorStage::Session,
            Self::VoiceHostUnavailable
            | Self::VoiceHostLanDisabled
            | Self::ProviderBindingInvalid => VoiceErrorStage::Provider,
            Self::LlmUnavailable => VoiceErrorStage::Llm,
            Self::ToolExecutionFailed => VoiceErrorStage::Tool,
            Self::TtsProviderUnavailable => VoiceErrorStage::Tts,
            Self::ResourcePressure => VoiceErrorStage::Resource,
            Self::ThermalLimit => VoiceErrorStage::Thermal,
            Self::NetworkConnectionLost | Self::NetworkRateLimited => VoiceErrorStage::Network,
            Self::UnclassifiedRuntimeError => VoiceErrorStage::UnsupportedCapability,
            Self::AbiUnsupported => VoiceErrorStage::Abi,
            Self::LoggingFailure => VoiceErrorStage::Logging,
        }
    }

    pub const fn recoverable(self) -> bool {
        matches!(
            self,
            Self::AudioInputUnavailable
                | Self::AudioOutputUnavailable
                | Self::ModelDownloadFailed
                | Self::VoiceHostUnavailable
                | Self::LlmUnavailable
                | Self::ToolExecutionFailed
                | Self::ResourcePressure
                | Self::ThermalLimit
                | Self::NetworkConnectionLost
                | Self::NetworkRateLimited
                | Self::LoggingFailure
        )
    }

    pub const fn cause(self) -> VoiceErrorCause {
        match self {
            Self::MicrophonePermissionDenied => VoiceErrorCause::Permission,
            Self::AudioInputUnavailable | Self::AudioOutputUnavailable | Self::ThermalLimit => {
                VoiceErrorCause::Device
            }
            Self::RequiredModelMissing
            | Self::ModelDownloadFailed
            | Self::VadProviderUnavailable
            | Self::TurnDetectionUnavailable
            | Self::SttProviderUnavailable
            | Self::TtsProviderUnavailable
            | Self::VoiceHostUnavailable
            | Self::ResourcePressure => VoiceErrorCause::Availability,
            Self::IntegrityVerificationFailed
            | Self::ModelLoadFailed
            | Self::VoiceHostLanDisabled
            | Self::ProviderBindingInvalid
            | Self::AbiUnsupported => VoiceErrorCause::Provider,
            Self::SessionAgentError
            | Self::SessionAgentUnavailable
            | Self::LlmUnavailable
            | Self::ToolExecutionFailed => VoiceErrorCause::Session,
            Self::NetworkConnectionLost | Self::NetworkRateLimited => VoiceErrorCause::Network,
            Self::UnclassifiedRuntimeError => VoiceErrorCause::Programmer,
            Self::LoggingFailure => VoiceErrorCause::Availability,
        }
    }

    pub const fn safe_detail(self) -> &'static str {
        match self {
            Self::AudioInputUnavailable => "Audio input is unavailable.",
            Self::AudioOutputUnavailable => "Audio output is unavailable.",
            Self::MicrophonePermissionDenied => "Microphone permission was denied.",
            Self::RequiredModelMissing => "A required speech model is missing.",
            Self::ModelDownloadFailed => "A speech model could not be downloaded.",
            Self::IntegrityVerificationFailed => "A speech model failed integrity verification.",
            Self::ModelLoadFailed => "A speech model could not be loaded.",
            Self::VadProviderUnavailable => "The voice activity detector is unavailable.",
            Self::TurnDetectionUnavailable => "The turn detection provider is unavailable.",
            Self::SttProviderUnavailable => "The speech recognition provider is unavailable.",
            Self::SessionAgentError => "The Unifia session returned an error.",
            Self::SessionAgentUnavailable => "The Unifia session is unavailable.",
            Self::VoiceHostUnavailable => "The configured Voice Host is unavailable.",
            Self::VoiceHostLanDisabled => "Voice Host LAN access is disabled.",
            Self::ProviderBindingInvalid => "The Voice provider binding is invalid.",
            Self::LlmUnavailable => "The selected language model is unavailable.",
            Self::ToolExecutionFailed => "A session tool failed.",
            Self::TtsProviderUnavailable => "The speech synthesis provider is unavailable.",
            Self::ResourcePressure => "Voice resources are under pressure.",
            Self::ThermalLimit => "The device is thermally constrained.",
            Self::NetworkConnectionLost => "The Voice network connection was lost.",
            Self::NetworkRateLimited => "The selected remote provider is rate limited.",
            Self::UnclassifiedRuntimeError => "An unclassified Voice runtime failure occurred.",
            Self::AbiUnsupported => "The speech runtime ABI is unsupported.",
            Self::LoggingFailure => "Voice diagnostics could not be recorded.",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceError {
    pub stage: VoiceErrorStage,
    pub code: VoiceErrorCode,
    pub recoverable: bool,
    #[serde(rename = "cause_category")]
    pub cause_category: VoiceErrorCause,
    #[serde(rename = "provider_id", skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    pub detail: String,
    #[serde(rename = "retry_after_ms", skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl VoiceError {
    /// Uses catalog-owned text so provider messages and transcripts cannot leak.
    pub fn from_code(code: VoiceErrorCode, provider_id: Option<String>) -> Self {
        Self {
            stage: code.stage(),
            code,
            recoverable: code.recoverable(),
            cause_category: code.cause(),
            provider_id,
            detail: code.safe_detail().to_owned(),
            retry_after_ms: None,
        }
    }

    pub fn validate(&self) -> Result<(), VoiceErrorValidationError> {
        if self.stage != self.code.stage() {
            return Err(VoiceErrorValidationError::StageCodeMismatch);
        }
        if self.recoverable != self.code.recoverable() || self.cause_category != self.code.cause() {
            return Err(VoiceErrorValidationError::CatalogMetadataMismatch);
        }
        if self.detail != self.code.safe_detail() {
            return Err(VoiceErrorValidationError::UntrustedDetail);
        }
        if self.retry_after_ms.is_some_and(|delay| delay > 86_400_000) {
            return Err(VoiceErrorValidationError::InvalidRetryAfter);
        }
        if self.provider_id.as_ref().is_some_and(|value| {
            value.len() > 120
                || !value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._@:-".contains(c))
        }) {
            return Err(VoiceErrorValidationError::InvalidProviderId);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceErrorValidationError {
    StageCodeMismatch,
    CatalogMetadataMismatch,
    UntrustedDetail,
    InvalidProviderId,
    InvalidRetryAfter,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_catalog_error_has_consistent_safe_metadata() {
        assert_eq!(VoiceErrorCode::ALL.len(), 25);
        for code in VoiceErrorCode::ALL {
            let error = VoiceError::from_code(code, None);
            assert_eq!(error.validate(), Ok(()));
            assert!(!error.detail.is_empty());
            assert!(!error.detail.to_ascii_lowercase().contains("token="));
            let value = serde_json::to_value(error).unwrap();
            assert!(value["code"].as_str().is_some());
            assert!(value["stage"].as_str().is_some());
        }
    }
}
