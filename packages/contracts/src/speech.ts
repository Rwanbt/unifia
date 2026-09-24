/** Stable, provider-neutral speech contracts shared by the app and runtimes. */

export const speechLanguages = ["en", "fr", "es", "it", "de"] as const

export type SpeechLanguage = (typeof speechLanguages)[number]
export type TtsProviderId = "pocket" | "piper"

export interface TtsCapabilities {
  streaming: boolean
  voiceCloning: boolean
  cpuOnly: boolean
  remoteCapable: boolean
  languages: SpeechLanguage[]
}

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

export interface TtsBackend {
  readonly id: TtsProviderId
  capabilities(): TtsCapabilities
  prepare(language: SpeechLanguage, signal?: AbortSignal): Promise<void>
  synthesize(request: TtsRequest, signal: AbortSignal): AsyncIterable<AudioFrame>
  cancel(requestId: string): Promise<void>
  dispose(): Promise<void>
}

export interface VoiceManifest {
  id: string
  provider: TtsProviderId
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
  list(language: SpeechLanguage, provider?: TtsProviderId): readonly VoiceManifest[]
  get(id: string, language: SpeechLanguage, provider?: TtsProviderId): VoiceManifest | undefined
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
    list(language: SpeechLanguage, provider?: TtsProviderId) {
      return [...byKey.values()].filter((voice) => voice.language === language && (!provider || voice.provider === provider))
    },
    get(id: string, language: SpeechLanguage, provider?: TtsProviderId) {
      if (provider) return byKey.get(`${provider}:${language}:${id}`)
      const matches = [...byKey.values()].filter((voice) => voice.id === id && voice.language === language)
      return matches.length === 1 ? matches[0] : undefined
    },
  })
}

export type TtsProviderPreference = "auto" | TtsProviderId

export interface TtsRouter {
  readonly voices: VoiceRegistry
  prepare(language: SpeechLanguage, signal?: AbortSignal): Promise<TtsProviderId>
  synthesize(request: TtsRequest, signal: AbortSignal): AsyncIterable<AudioFrame>
  cancel(requestId: string): Promise<void>
  dispose(): Promise<void>
}

/** Resolves explicit choices without silently selecting another provider. */
export function resolveTtsProviders(preference: TtsProviderPreference): readonly TtsProviderId[] {
  if (preference === "auto") return ["pocket", "piper"]
  return [preference]
}

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
  return typeof value === "string" && speechLanguages.some((language) => language === value)
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

/** Stable error codes shared by the Voice Host, the server and the UI. */
export type LiveVoiceError =
  | "microphone_denied"
  | "microphone_unavailable"
  | "voice_host_unavailable"
  | "voice_host_lan_disabled"
  | "stt_unavailable"
  | "tts_unavailable"
  | "agent_unavailable"
  | "binding_invalid"
  | "connection_lost"
  | "rate_limited"
  | "unknown"

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
