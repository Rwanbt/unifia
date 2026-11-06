/* SPDX-License-Identifier: MIT */
import {
  createVoiceError,
  type LiveVoiceError,
  type VoiceError,
  type VoiceErrorCauseCategory,
  type VoiceErrorStage,
} from "@unifia/contracts/speech"
import { TTS_ERROR_CODES } from "@unifia/contracts/tts-router"

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

export function nativeVoiceCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export const NATIVE_VOICE_KEYS = {
  model_missing: "prompt.live.error.sttUnavailable",
  model_corrupt: "prompt.live.error.sttUnavailable",
  audio_busy: "speech.error",
  live_active: "prompt.live.dictationDisabled",
  unsupported_language: "speech.unsupported",
  unsupported_format: "speech.error",
  not_available: "speech.unsupported",
  inference: "speech.error",
  cancelled: "speech.error",
  model_download_failed: "prompt.live.error.sttUnavailable",
  model_load_failed: "prompt.live.error.sttUnavailable",
  abi_unsupported: "prompt.live.error.localVoiceUnavailable",
  session_not_open: "speech.error",
  no_dictation: "speech.error",
  utterance_expired: "speech.error",
  session_failed: "speech.error",
  invalid_input: "speech.error",
} as const

export function nativeVoiceKey(error: unknown) {
  const code = nativeVoiceCode(error)
  if (!code || !Object.hasOwn(NATIVE_VOICE_KEYS, code)) return "speech.error"
  return NATIVE_VOICE_KEYS[code as keyof typeof NATIVE_VOICE_KEYS]
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
    const code = nativeVoiceCode(cause)
    const classified = code === "abi_unsupported"
      ? { ...stepClassification, ...ABI_CLASSIFICATION }
      : code === "model_missing"
        ? { ...stepClassification, stage: "model-missing" as const, code: "MODEL_MISSING_REQUIRED", causeCategory: "availability" as const }
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

/**
 * The speech output found no local neural voice that produced audio. Thrown so
 * the Live turn ends with a named cause instead of going silent. `reason` is
 * the last provider failure the router reported, when there was one.
 */
export class LocalSpeechUnavailableError extends Error {
  readonly voiceError: VoiceError

  constructor(language: string, reason: string | undefined, timestamp = Date.now(), code?: string) {
    const missingPack = code === TTS_ERROR_CODES.MODEL_MISSING
    super(reason ?? `No local voice produced audio for ${language}`, { cause: reason })
    this.name = "LocalSpeechUnavailableError"
    this.voiceError = {
      ...createVoiceError("tts_unavailable", timestamp),
      stage: missingPack ? "model-missing" : "tts",
      code: missingPack ? "MODEL_MISSING_REQUIRED" : "TTS_PROVIDER_UNAVAILABLE",
      detail: `No local voice produced audio for ${language}.`,
      recoverable: !missingPack,
      causeCategory: missingPack ? "availability" : "provider",
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
