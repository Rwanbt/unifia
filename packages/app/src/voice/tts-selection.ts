/* SPDX-License-Identifier: MIT */
import { isSpeechLanguage, type SpeechLanguage } from "@unifia/contracts/speech"
import { loadAudioSettings, type TtsLanguagePreference } from "./audio-settings"

/**
 * Speech language and conditioning sample, resolved from the saved settings.
 *
 * Two very different call paths need this and neither can reach the other:
 * `android-local-voice.ts` is the Live transport, and
 * `mobile/src/hooks/use-speech.ts` is the manual read-aloud path. They build
 * their own TtsRequest, so resolving here once is what keeps the voice the user
 * picked in the settings from applying to only half the app.
 *
 * The pack is chosen by language and the speaker by the prompt, so both are
 * read from settings rather than derived from the interface. `ttsLanguage:
 * "auto"` keeps following `document.lang`, which is what every record written
 * before the setting existed means, so no migration is required.
 */
export interface TtsSelection {
  language: SpeechLanguage
  voice: string | undefined
  /** Per-language rate when set, otherwise the global one. */
  speed: number
}

/**
 * The speech language a `ttsLanguage` preference stands for. `"auto"` follows
 * the interface language; one with no speech pack falls back to English rather
 * than indexing the voice table with a language that has no entry.
 */
export function resolveTtsLanguage(
  preference: TtsLanguagePreference,
  interfaceLanguage: string = document.documentElement.lang || navigator.language || "en",
): SpeechLanguage {
  if (preference !== "auto") return preference
  const primary = interfaceLanguage.slice(0, 2).toLowerCase()
  return isSpeechLanguage(primary) ? primary : "en"
}

export function resolveTtsSelection(): TtsSelection {
  const settings = loadAudioSettings()
  const language = resolveTtsLanguage(settings.ttsLanguage)
  return {
    language,
    voice: settings.voiceByLanguage[language],
    speed: settings.ttsSpeedByLanguage[language] ?? settings.ttsSpeed,
  }
}
