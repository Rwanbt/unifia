import { isSpeechLanguage, type SpeechLanguage, type TtsProviderPreference } from "@unifia/contracts/speech"

export const AUDIO_SETTINGS_STORAGE_KEY = "unifia-audio-settings.v2"
export const LEGACY_AUDIO_SETTINGS_STORAGE_KEY = "unifia-audio-settings"
export const AUDIO_SETTINGS_VERSION = 2

export type SttLanguagePreference = "auto" | SpeechLanguage
/** `auto` follows the app interface language, as the voice router did before. */
export type TtsLanguagePreference = "auto" | SpeechLanguage
export type CpuProfile = "eco" | "balanced" | "fast"

export interface AudioSettingsV2 {
  version: typeof AUDIO_SETTINGS_VERSION
  sttEnabled: boolean
  sttLanguage: SttLanguagePreference
  ttsEnabled: boolean
  ttsProvider: TtsProviderPreference
  /**
   * Speech language. The pack is selected by language, so this is what decides
   * which model speaks, independently of the interface language.
   */
  ttsLanguage: TtsLanguagePreference
  ttsSpeed: number
  /**
   * Per-language speed, falling back to `ttsSpeed`. The 6-layer English packs
   * are already at a natural pace while the 24-layer French pack was reported
   * as markedly slower, so a single global rate would fix one language by
   * breaking the other.
   */
  ttsSpeedByLanguage: Partial<Record<SpeechLanguage, number>>
  ttsAutoPlay: boolean
  voiceByLanguage: Partial<Record<SpeechLanguage, string>>
  liveEnabled: boolean
  /** Live microphone/speaker; undefined means the system default device. */
  liveInputDeviceId?: string
  liveOutputDeviceId?: string
  voiceHostMode: "local" | "lan"
  cpuProfile: CpuProfile
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettingsV2 = {
  version: AUDIO_SETTINGS_VERSION,
  sttEnabled: true,
  sttLanguage: "auto",
  ttsEnabled: true,
  ttsProvider: "auto",
  ttsLanguage: "auto",
  ttsSpeed: 1,
  ttsSpeedByLanguage: {},
  ttsAutoPlay: false,
  voiceByLanguage: {},
  liveEnabled: true,
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

function normalizeSpeeds(value: unknown): Partial<Record<SpeechLanguage, number>> {
  if (!isRecord(value)) return {}
  const speeds: Partial<Record<SpeechLanguage, number>> = {}
  for (const [language, speed] of Object.entries(value)) {
    // A language entry must survive as a real SpeechLanguage, or a hand-edited
    // record would make the speed picker address a language with no pack.
    if (isSpeechLanguage(language) && typeof speed === "number") {
      speeds[language] = Math.min(2, Math.max(0.5, speed))
    }
  }
  return speeds
}

function normalizeDeviceId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 512 ? value : undefined
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
  // Older records have no ttsLanguage; "auto" reproduces their behaviour of
  // following the interface language, so no migration is needed.
  const ttsLanguageRaw = value.ttsLanguage
  const ttsLanguage: TtsLanguagePreference =
    ttsLanguageRaw === "auto" || isSpeechLanguage(ttsLanguageRaw) ? ttsLanguageRaw : "auto"
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
    ttsLanguage,
    ttsSpeed: normalizeSpeed(value.ttsSpeed),
    ttsSpeedByLanguage: normalizeSpeeds(value.ttsSpeedByLanguage),
    ttsAutoPlay: typeof value.ttsAutoPlay === "boolean" ? value.ttsAutoPlay : DEFAULT_AUDIO_SETTINGS.ttsAutoPlay,
    voiceByLanguage: normalizeVoices(value.voiceByLanguage),
    liveEnabled: typeof value.liveEnabled === "boolean" ? value.liveEnabled : DEFAULT_AUDIO_SETTINGS.liveEnabled,
    liveInputDeviceId: normalizeDeviceId(value.liveInputDeviceId),
    liveOutputDeviceId: normalizeDeviceId(value.liveOutputDeviceId),
    voiceHostMode: value.voiceHostMode === "lan" ? "lan" : "local",
    cpuProfile,
  }
}

export function loadAudioSettings(storage?: Pick<Storage, "getItem">): AudioSettingsV2 {
  try {
    const settingsStorage = storage ?? globalThis.localStorage
    const raw = settingsStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY)
      ?? settingsStorage.getItem(LEGACY_AUDIO_SETTINGS_STORAGE_KEY)
    return raw ? migrateAudioSettings(JSON.parse(raw)) : migrateAudioSettings(undefined)
  } catch {
    return migrateAudioSettings(undefined)
  }
}

export function serializeAudioSettings(settings: AudioSettingsV2): string {
  return JSON.stringify(migrateAudioSettings(settings))
}

export function saveAudioSettings(settings: AudioSettingsV2, storage?: Pick<Storage, "setItem">): boolean {
  try {
    ;(storage ?? globalThis.localStorage).setItem(AUDIO_SETTINGS_STORAGE_KEY, serializeAudioSettings(settings))
    return true
  } catch {
    return false
  }
}
