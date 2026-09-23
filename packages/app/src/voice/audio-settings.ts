import { isSpeechLanguage, type SpeechLanguage, type TtsProviderPreference } from "@unifia/contracts/speech"

export const AUDIO_SETTINGS_STORAGE_KEY = "unifia-audio-settings"
export const AUDIO_SETTINGS_VERSION = 2

export type SttLanguagePreference = "auto" | SpeechLanguage
export type CpuProfile = "eco" | "balanced" | "fast"

export interface AudioSettingsV2 {
  version: typeof AUDIO_SETTINGS_VERSION
  sttEnabled: boolean
  sttLanguage: SttLanguagePreference
  ttsEnabled: boolean
  ttsProvider: TtsProviderPreference
  ttsSpeed: number
  ttsAutoPlay: boolean
  voiceByLanguage: Partial<Record<SpeechLanguage, string>>
  liveEnabled: boolean
  voiceHostMode: "local" | "lan"
  cpuProfile: CpuProfile
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettingsV2 = {
  version: AUDIO_SETTINGS_VERSION,
  sttEnabled: true,
  sttLanguage: "auto",
  ttsEnabled: true,
  ttsProvider: "auto",
  ttsSpeed: 1,
  ttsAutoPlay: false,
  voiceByLanguage: {},
  liveEnabled: false,
  voiceHostMode: "local",
  cpuProfile: "balanced",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AUDIO_SETTINGS.ttsSpeed
  return Math.min(2, Math.max(0.5, value))
}

function normalizeVoices(value: unknown): Partial<Record<SpeechLanguage, string>> {
  if (!isRecord(value)) return {}
  const voices: Partial<Record<SpeechLanguage, string>> = {}
  for (const [language, voice] of Object.entries(value)) {
    if (isSpeechLanguage(language) && typeof voice === "string" && voice.trim()) {
      voices[language] = voice.trim()
    }
  }
  return voices
}

/** Migrates historical audio preferences without preserving removed providers or voice IDs. */
export function migrateAudioSettings(value: unknown): AudioSettingsV2 {
  if (!isRecord(value)) return { ...DEFAULT_AUDIO_SETTINGS, voiceByLanguage: {} }

  const provider = value.ttsProvider
  const ttsProvider: TtsProviderPreference =
    provider === "pocket" || provider === "piper" || provider === "auto" ? provider : "auto"
  const language = value.sttLanguage
  const sttLanguage: SttLanguagePreference = language === "auto" || isSpeechLanguage(language) ? language : "auto"
  const cpuProfile: CpuProfile =
    value.cpuProfile === "eco" || value.cpuProfile === "fast" || value.cpuProfile === "balanced"
      ? value.cpuProfile
      : DEFAULT_AUDIO_SETTINGS.cpuProfile

  return {
    version: AUDIO_SETTINGS_VERSION,
    sttEnabled: typeof value.sttEnabled === "boolean" ? value.sttEnabled : DEFAULT_AUDIO_SETTINGS.sttEnabled,
    sttLanguage,
    ttsEnabled: typeof value.ttsEnabled === "boolean" ? value.ttsEnabled : DEFAULT_AUDIO_SETTINGS.ttsEnabled,
    ttsProvider,
    ttsSpeed: normalizeSpeed(value.ttsSpeed),
    ttsAutoPlay: typeof value.ttsAutoPlay === "boolean" ? value.ttsAutoPlay : DEFAULT_AUDIO_SETTINGS.ttsAutoPlay,
    voiceByLanguage: normalizeVoices(value.voiceByLanguage),
    liveEnabled: typeof value.liveEnabled === "boolean" ? value.liveEnabled : DEFAULT_AUDIO_SETTINGS.liveEnabled,
    voiceHostMode: value.voiceHostMode === "lan" ? "lan" : "local",
    cpuProfile,
  }
}

export function loadAudioSettings(storage?: Pick<Storage, "getItem">): AudioSettingsV2 {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(AUDIO_SETTINGS_STORAGE_KEY)
    return raw ? migrateAudioSettings(JSON.parse(raw)) : migrateAudioSettings(undefined)
  } catch {
    return migrateAudioSettings(undefined)
  }
}

export function serializeAudioSettings(settings: AudioSettingsV2): string {
  return JSON.stringify(migrateAudioSettings(settings))
}
