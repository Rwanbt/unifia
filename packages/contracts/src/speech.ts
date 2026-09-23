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
    if (!manifest.license.trim() || !manifest.licenseSource.trim()) {
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
