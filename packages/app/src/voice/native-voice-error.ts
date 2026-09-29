/* SPDX-License-Identifier: MIT */
import {
  createVoiceError,
  type LiveVoiceError,
  type VoiceError,
  type VoiceErrorCauseCategory,
  type VoiceErrorStage,
} from "@unifia/contracts/speech"

/** Prefix the Rust ONNX Runtime guard (`onnx_runtime.rs`) puts on a runtime/API-level mismatch. */
const ABI_UNSUPPORTED_PREFIX = "ABI_UNSUPPORTED"

/** A native Tauri call on the Android Live start/turn path. */
export type NativeVoiceStep = "stt-download" | "stt-load" | "stt-transcribe" | "audio-open"

type StepClassification = {
  legacyCode: LiveVoiceError
  stage: VoiceErrorStage
  code: string
  detail: string
  recoverable: boolean
  causeCategory: VoiceErrorCauseCategory
}

const STEP_CLASSIFICATION: Record<NativeVoiceStep, StepClassification> = {
  "stt-download": {
    legacyCode: "stt_unavailable",
    stage: "model-download",
    code: "MODEL_DOWNLOAD_FAILED",
    detail: "The local speech recognition model could not be downloaded.",
    recoverable: true,
    causeCategory: "availability",
  },
  "stt-load": {
    legacyCode: "stt_unavailable",
    stage: "model-load",
    code: "MODEL_LOAD_FAILED",
    detail: "The local speech recognition model could not be loaded.",
    recoverable: true,
    causeCategory: "provider",
  },
  "stt-transcribe": {
    legacyCode: "stt_unavailable",
    stage: "stt",
    code: "STT_PROVIDER_UNAVAILABLE",
    detail: "Local speech recognition failed for this utterance.",
    recoverable: true,
    causeCategory: "provider",
  },
  "audio-open": {
    legacyCode: "microphone_unavailable",
    stage: "audio-input",
    code: "AUDIO_INPUT_UNAVAILABLE",
    detail: "The native microphone stream could not be opened.",
    recoverable: true,
    causeCategory: "device",
  },
}

const ABI_CLASSIFICATION: Omit<StepClassification, "legacyCode"> = {
  stage: "abi",
  code: "ABI_UNSUPPORTED",
  detail: "The bundled ONNX Runtime is incompatible with this build; local speech models cannot run.",
  recoverable: false,
  causeCategory: "programmer",
}

function nativeMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  return ""
}

/**
 * Carries a stage-classified VoiceError for a failed native call. The raw
 * native message stays on `cause` for logs and is never shown to the user,
 * because it can hold device paths.
 */
export class NativeVoiceStepError extends Error {
  readonly voiceError: VoiceError

  constructor(
    readonly step: NativeVoiceStep,
    cause: unknown,
    timestamp = Date.now(),
  ) {
    const stepClassification = STEP_CLASSIFICATION[step]
    const classified = nativeMessage(cause).startsWith(ABI_UNSUPPORTED_PREFIX)
      ? { ...stepClassification, ...ABI_CLASSIFICATION }
      : stepClassification
    super(classified.detail, { cause })
    this.name = "NativeVoiceStepError"
    this.voiceError = {
      ...createVoiceError(classified.legacyCode, timestamp),
      stage: classified.stage,
      code: classified.code,
      detail: classified.detail,
      recoverable: classified.recoverable,
      causeCategory: classified.causeCategory,
    }
  }
}

export async function runNativeVoiceStep<T>(step: NativeVoiceStep, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    throw new NativeVoiceStepError(step, error)
  }
}
