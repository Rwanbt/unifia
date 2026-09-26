/* SPDX-License-Identifier: MIT */
/** Stable, provider-neutral speech contracts shared by the app and runtimes. */

export const speechLanguages = ["en", "fr", "es", "it", "de"] as const

export type SpeechLanguage = (typeof speechLanguages)[number]

export interface TtsRequest {
  id: string
  text: string
  language: SpeechLanguage
  voice?: string
  speed: number
}

export interface AudioFrame {
  sampleRate: number
  channels: number
  pcm: Int16Array | Float32Array
}

export interface VoiceManifest {
  id: string
  /** Provider identifier; matches `TtsProviderId` in `@unifia/contracts/tts-router`. */
  provider: "pocket" | "piper" | "fallback-android-tts"
  language: SpeechLanguage
  displayName: string
  version: string
  source: string
  sha256?: string
  license: string
  licenseSource: string
  redistributable: boolean
}

export interface VoiceRegistry {
  list(language: SpeechLanguage, provider?: VoiceManifest["provider"]): readonly VoiceManifest[]
  get(id: string, language: SpeechLanguage, provider?: VoiceManifest["provider"]): VoiceManifest | undefined
}

export function createVoiceRegistry(manifests: readonly VoiceManifest[]): VoiceRegistry {
  const byKey = new Map<string, VoiceManifest>()
  for (const manifest of manifests) {
    if (!manifest.id.trim() || !manifest.displayName.trim() || !manifest.version.trim()) {
      throw new Error("Voice manifests require an id, display name, and version")
    }
    if (!manifest.source.trim() || !manifest.license.trim() || !manifest.licenseSource.trim()) {
      throw new Error(`Voice ${manifest.id} is missing verified license metadata`)
    }
    const key = `${manifest.provider}:${manifest.language}:${manifest.id}`
    if (byKey.has(key)) throw new Error(`Duplicate voice manifest: ${key}`)
    byKey.set(key, Object.freeze({ ...manifest }))
  }

  return Object.freeze({
    list(language: SpeechLanguage, provider?: VoiceManifest["provider"]) {
      return [...byKey.values()].filter((voice) => voice.language === language && (!provider || voice.provider === provider))
    },
    get(id: string, language: SpeechLanguage, provider?: VoiceManifest["provider"]) {
      if (provider) return byKey.get(`${provider}:${language}:${id}`)
      const matches = [...byKey.values()].filter((voice) => voice.id === id && voice.language === language)
      return matches.length === 1 ? matches[0] : undefined
    },
  })
}

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
  return typeof value === "string" && speechLanguages.some((language) => language === value)
}

/** User-facing TTS provider preference. Independent of the canonical
 *  `TtsProviderId` exported by `@unifia/contracts/tts-router` —
 *  audio-settings UI only needs to know which provider to prefer
 *  without depending on the router contract. */
export type TtsProviderChoice = "pocket" | "piper" | "fallback-android-tts"
export type TtsProviderPreference = "auto" | TtsProviderChoice

/** Resolves explicit choices without silently selecting another provider. */
export function resolveTtsProviders(preference: TtsProviderPreference): readonly TtsProviderChoice[] {
  if (preference === "auto") return ["pocket", "piper", "fallback-android-tts"]
  return [preference]
}

export interface LanguageRouteInput {
  preference?: "auto" | SpeechLanguage
  detectedLanguage?: SpeechLanguage
  conversationLanguage?: SpeechLanguage
  applicationLocale?: string
  text?: string
  previousAutomaticLanguage?: SpeechLanguage
}

function localeLanguage(locale: string | undefined): SpeechLanguage | undefined {
  const primaryTag = locale?.trim().toLowerCase().split(/[-_]/, 1)[0]
  return isSpeechLanguage(primaryTag) ? primaryTag : undefined
}

function isShortUtterance(text: string | undefined): boolean {
  const words = text?.trim().split(/\s+/).filter(Boolean) ?? []
  return words.length > 0 && words.length <= 2
}

/** Resolves the frozen language priority while stabilizing short auto-detected turns. */
export function resolveSpeechLanguage(input: LanguageRouteInput): SpeechLanguage {
  if (input.preference && input.preference !== "auto") return input.preference
  if (input.detectedLanguage) {
    if (isShortUtterance(input.text) && input.previousAutomaticLanguage) {
      return input.previousAutomaticLanguage
    }
    return input.detectedLanguage
  }
  return input.conversationLanguage ?? localeLanguage(input.applicationLocale) ?? "en"
}

/** Live conversation UI state; never collapsed to a boolean. */
export const liveVoiceStates = [
  "idle",
  "connecting",
  "listening",
  "processing",
  "thinking",
  "speaking",
  "working",
  "reconnecting",
  "error",
] as const
export type LiveVoiceState = (typeof liveVoiceStates)[number]

export const liveVoiceErrors = [
  "microphone_denied",
  "microphone_unavailable",
  "voice_host_unavailable",
  "voice_host_lan_disabled",
  "stt_unavailable",
  "tts_unavailable",
  "agent_unavailable",
  "binding_invalid",
  "connection_lost",
  "rate_limited",
  "voice_internal_error",
] as const

/** Stable legacy identifiers kept for UI translation compatibility. */
export type LiveVoiceError = (typeof liveVoiceErrors)[number]

export function isLiveVoiceError(value: unknown): value is LiveVoiceError {
  return typeof value === "string" && liveVoiceErrors.some((code) => code === value)
}

export const voiceErrorStages = [
  "audio-input",
  "audio-output",
  "permission",
  "model-missing",
  "model-download",
  "integrity",
  "model-load",
  "vad",
  "turn-detection",
  "stt",
  "session",
  "provider",
  "llm",
  "tool",
  "tts",
  "resource",
  "thermal",
  "network",
  "unsupported-capability",
  "abi",
  "logging",
] as const

export type VoiceErrorStage = (typeof voiceErrorStages)[number]
export type VoiceErrorCauseCategory = "permission" | "device" | "availability" | "provider" | "session" | "network" | "programmer"
const MAX_VOICE_ERROR_ID_LENGTH = 128
const MAX_VOICE_ERROR_PROVIDER_LENGTH = 120
const MAX_VOICE_ERROR_RETRY_MS = 86_400_000

export interface VoiceError {
  stage: VoiceErrorStage
  code: string
  legacyCode: LiveVoiceError
  recoverable: boolean
  providerId?: string
  detail: string
  causeCategory: VoiceErrorCauseCategory
  timestamp: number
}

/** Ordered event envelope used by platform adapters when surfacing a Voice failure. */
export interface VoiceErrorEvent {
  kind: "voice_error"
  sessionID: string
  turnID?: string
  ts: number
  seq: number
  stage: VoiceErrorStage
  code: string
  detail: string
  recoverable: boolean
  provider_id?: string
  retry_after_ms?: number
}

/** Live becomes listening only after the runtime publishes this readiness event. */
export interface VoiceReadyEvent {
  kind: "voice_ready"
  sessionID: string
  ts: number
  seq: number
  profile: "live"
}

const VOICE_ERROR_DEFINITIONS: Record<LiveVoiceError, Omit<VoiceError, "legacyCode" | "timestamp" | "providerId">> = {
  microphone_denied: {
    stage: "permission",
    code: "PERMISSION_MICROPHONE_DENIED",
    recoverable: false,
    detail: "Microphone permission was denied.",
    causeCategory: "permission",
  },
  microphone_unavailable: {
    stage: "audio-input",
    code: "AUDIO_INPUT_UNAVAILABLE",
    recoverable: true,
    detail: "The microphone is unavailable.",
    causeCategory: "device",
  },
  voice_host_unavailable: {
    stage: "provider",
    code: "PROVIDER_VOICE_HOST_UNAVAILABLE",
    recoverable: true,
    detail: "The configured Voice Host is unavailable.",
    causeCategory: "availability",
  },
  voice_host_lan_disabled: {
    stage: "provider",
    code: "PROVIDER_LAN_ACCESS_DISABLED",
    recoverable: false,
    detail: "Voice Host LAN access is disabled.",
    causeCategory: "provider",
  },
  stt_unavailable: {
    stage: "stt",
    code: "STT_PROVIDER_UNAVAILABLE",
    recoverable: true,
    detail: "The configured speech recognition provider is unavailable.",
    causeCategory: "availability",
  },
  tts_unavailable: {
    stage: "tts",
    code: "TTS_PROVIDER_UNAVAILABLE",
    recoverable: true,
    detail: "The configured speech synthesis provider is unavailable.",
    causeCategory: "availability",
  },
  agent_unavailable: {
    stage: "session",
    code: "SESSION_AGENT_UNAVAILABLE",
    recoverable: true,
    detail: "The Unifia session agent is unavailable.",
    causeCategory: "session",
  },
  binding_invalid: {
    stage: "provider",
    code: "PROVIDER_BINDING_INVALID",
    recoverable: false,
    detail: "The Voice provider binding is no longer valid.",
    causeCategory: "provider",
  },
  connection_lost: {
    stage: "network",
    code: "NETWORK_CONNECTION_LOST",
    recoverable: true,
    detail: "The Voice connection was lost.",
    causeCategory: "network",
  },
  rate_limited: {
    stage: "network",
    code: "NETWORK_RATE_LIMITED",
    recoverable: true,
    detail: "The Voice provider is rate limited.",
    causeCategory: "network",
  },
  voice_internal_error: {
    stage: "unsupported-capability",
    code: "UNSUPPORTED_CAPABILITY_UNCLASSIFIED_RUNTIME_ERROR",
    recoverable: false,
    detail: "An unclassified Voice runtime failure occurred.",
    causeCategory: "programmer",
  },
}

const VOICE_ERROR_EVENT_CODE_STAGES: Readonly<Record<string, VoiceErrorStage>> = {
  PERMISSION_MICROPHONE_DENIED: "permission",
  AUDIO_INPUT_UNAVAILABLE: "audio-input",
  PROVIDER_VOICE_HOST_UNAVAILABLE: "provider",
  PROVIDER_LAN_ACCESS_DISABLED: "provider",
  STT_PROVIDER_UNAVAILABLE: "stt",
  TTS_PROVIDER_UNAVAILABLE: "tts",
  VAD_PROVIDER_UNAVAILABLE: "vad",
  TURN_DETECTOR_UNAVAILABLE: "turn-detection",
  SESSION_AGENT_UNAVAILABLE: "session",
  SESSION_AGENT_ERROR: "session",
  PROVIDER_BINDING_INVALID: "provider",
  NETWORK_CONNECTION_LOST: "network",
  NETWORK_RATE_LIMITED: "network",
  UNSUPPORTED_CAPABILITY_UNCLASSIFIED_RUNTIME_ERROR: "unsupported-capability",
}

export function createVoiceError(legacyCode: LiveVoiceError, timestamp = Date.now()): VoiceError {
  return { ...VOICE_ERROR_DEFINITIONS[legacyCode], legacyCode, timestamp }
}

export function voiceErrorCodeMatchesStage(stage: VoiceErrorStage, code: string): boolean {
  return VOICE_ERROR_EVENT_CODE_STAGES[code] === stage
}

export function createVoiceErrorEvent(
  error: VoiceError,
  identity: { sessionID: string; turnID?: string; seq: number },
): VoiceErrorEvent {
  return {
    kind: "voice_error",
    sessionID: identity.sessionID,
    ...(identity.turnID ? { turnID: identity.turnID } : {}),
    ts: error.timestamp,
    seq: identity.seq,
    stage: error.stage,
    code: error.code,
    detail: error.detail,
    recoverable: error.recoverable,
    ...(error.providerId ? { provider_id: error.providerId } : {}),
  }
}

export function isVoiceErrorEvent(value: unknown): value is VoiceErrorEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const event = value as Partial<VoiceErrorEvent>
  return event.kind === "voice_error"
    && typeof event.sessionID === "string"
    && event.sessionID.startsWith("ses_")
    && event.sessionID.length > "ses_".length
    && event.sessionID.length <= MAX_VOICE_ERROR_ID_LENGTH
    && (event.turnID === undefined || (typeof event.turnID === "string" && event.turnID.length <= MAX_VOICE_ERROR_ID_LENGTH))
    && typeof event.ts === "number"
    && Number.isFinite(event.ts)
    && typeof event.seq === "number"
    && Number.isSafeInteger(event.seq)
    && event.seq >= 0
    && typeof event.stage === "string"
    && voiceErrorStages.some((stage) => stage === event.stage)
    && typeof event.code === "string"
    && voiceErrorCodeMatchesStage(event.stage, event.code)
    && typeof event.detail === "string"
    && event.detail.length <= 240
    && !/(?:bearer\s+\S+|(?:api[_-]?key|authorization|token)\s*[:=]\s*\S+)/i.test(event.detail)
    && typeof event.recoverable === "boolean"
    && (event.provider_id === undefined || (typeof event.provider_id === "string" && event.provider_id.length <= MAX_VOICE_ERROR_PROVIDER_LENGTH && /^[A-Za-z0-9._@:-]+$/.test(event.provider_id)))
    && (event.retry_after_ms === undefined || (typeof event.retry_after_ms === "number" && Number.isSafeInteger(event.retry_after_ms) && event.retry_after_ms >= 0 && event.retry_after_ms <= MAX_VOICE_ERROR_RETRY_MS))
}

export function isVoiceReadyEvent(value: unknown): value is VoiceReadyEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const event = value as Partial<VoiceReadyEvent>
  return event.kind === "voice_ready"
    && typeof event.sessionID === "string"
    && event.sessionID.startsWith("ses_")
    && event.sessionID.length > "ses_".length
    && event.sessionID.length <= MAX_VOICE_ERROR_ID_LENGTH
    && typeof event.ts === "number"
    && Number.isFinite(event.ts)
    && typeof event.seq === "number"
    && Number.isSafeInteger(event.seq)
    && event.seq >= 0
    && event.profile === "live"
}

export function voiceErrorFromEvent(event: VoiceErrorEvent): VoiceError {
  const legacyCode: LiveVoiceError = event.stage === "permission"
    ? "microphone_denied"
    : event.stage === "audio-input"
      ? "microphone_unavailable"
      : event.stage === "stt"
        ? "stt_unavailable"
        : event.stage === "tts" || event.stage === "audio-output"
          ? "tts_unavailable"
          : event.stage === "session" || event.stage === "llm" || event.stage === "tool"
            ? "agent_unavailable"
            : event.stage === "network"
              ? "connection_lost"
              : event.stage === "provider"
                ? "voice_host_unavailable"
                : "voice_internal_error"
  return {
    ...createVoiceError(legacyCode, event.ts),
    stage: event.stage,
    code: event.code,
    recoverable: event.recoverable,
    providerId: event.provider_id,
  }
}

/** One finalized user utterance handed to the Unifia session. */
export interface VoiceTurn {
  id: string
  sessionId: string
  deviceId: string
  transcript: string
  language: SpeechLanguage
  startedAt: number
  endedAt: number
}

export type VoiceAgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-start"; name: string }
  | { type: "tool-end"; name: string }
  | { type: "permission-required"; id: string }
  | { type: "working"; text?: string }
  | { type: "done" }
  | { type: "error"; message: string }

/** Response of ``POST /voice/live/session`` on the Unifia server. */
export interface LiveRoomGrant {
  url: string
  token: string
  expiresAt: number
  room: string
  binding: string
  sessionID: string | null
}
