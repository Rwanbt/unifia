/* SPDX-License-Identifier: MIT */
import { isSpeechLanguage, type SpeechLanguage } from "@unifia/contracts/speech"
import { loadAudioSettings } from "./audio-settings"

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
export function resolveTtsSelection(): { language: SpeechLanguage; voice: string | undefined } {
  const settings = loadAudioSettings()
  const auto = (document.documentElement.lang || navigator.language || "en")
    .slice(0, 2)
    .toLowerCase()
  // An interface language with no speech pack falls back to English rather
  // than indexing the voice table with a language that has no entry.
  const language: SpeechLanguage =
    settings.ttsLanguage === "auto"
      ? isSpeechLanguage(auto)
        ? auto
        : "en"
      : settings.ttsLanguage
  return { language, voice: settings.voiceByLanguage[language] }
}
