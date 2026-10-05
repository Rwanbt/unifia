/* SPDX-License-Identifier: MIT */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, type AudioSettingsV2 } from "./audio-settings"
import { resolveTtsLanguage, resolveTtsSelection } from "./tts-selection"

let originalLang: string

function saveSettings(overrides: Partial<AudioSettingsV2>) {
  localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, ...overrides }))
}

beforeEach(() => {
  originalLang = document.documentElement.lang
  localStorage.removeItem(AUDIO_SETTINGS_STORAGE_KEY)
})

afterEach(() => {
  document.documentElement.lang = originalLang
  localStorage.removeItem(AUDIO_SETTINGS_STORAGE_KEY)
})

describe("resolveTtsLanguage", () => {
  test("an explicit preference is returned unchanged", () => {
    expect(resolveTtsLanguage("de", "fr-FR")).toBe("de")
  })

  test("auto takes the primary subtag case-insensitively", () => {
    expect(resolveTtsLanguage("auto", "IT-it")).toBe("it")
  })

  test("auto with an interface language that has no pack is English", () => {
    expect(resolveTtsLanguage("auto", "ja-JP")).toBe("en")
    expect(resolveTtsLanguage("auto", "")).toBe("en")
  })

  test("without an explicit interface language it reads the document", () => {
    document.documentElement.lang = "es-ES"
    expect(resolveTtsLanguage("auto")).toBe("es")
  })
})

describe("resolveTtsSelection", () => {
  test("auto follows the interface language from its primary subtag", () => {
    document.documentElement.lang = "fr-FR"
    saveSettings({ ttsLanguage: "auto" })

    expect(resolveTtsSelection().language).toBe("fr")
  })

  test("auto falls back to English when the interface language has no speech pack", () => {
    document.documentElement.lang = "xx-YY"
    saveSettings({ ttsLanguage: "auto" })

    expect(resolveTtsSelection().language).toBe("en")
  })

  test("an explicit speech language wins over the interface language", () => {
    document.documentElement.lang = "fr"
    saveSettings({ ttsLanguage: "en" })

    expect(resolveTtsSelection().language).toBe("en")
  })

  test("a record written before the setting existed keeps following the interface", () => {
    document.documentElement.lang = "fr"
    const { ttsLanguage: _omitted, ...legacy } = DEFAULT_AUDIO_SETTINGS
    localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(legacy))

    expect(resolveTtsSelection().language).toBe("fr")
  })

  test("the voice is the one saved for the resolved language, not another language's", () => {
    document.documentElement.lang = "fr"
    saveSettings({ ttsLanguage: "auto", voiceByLanguage: { en: "en_voice", fr: "fr_voice" } })

    expect(resolveTtsSelection().voice).toBe("fr_voice")
  })

  test("no saved voice for the language leaves the choice to the router", () => {
    saveSettings({ ttsLanguage: "en", voiceByLanguage: { fr: "fr_voice" } })

    expect(resolveTtsSelection().voice).toBeUndefined()
  })

  test("the per-language rate overrides the global rate", () => {
    saveSettings({ ttsLanguage: "fr", ttsSpeed: 1, ttsSpeedByLanguage: { fr: 1.4 } })

    expect(resolveTtsSelection().speed).toBe(1.4)
  })

  test("a language without its own rate uses the global rate", () => {
    saveSettings({ ttsLanguage: "en", ttsSpeed: 1.2, ttsSpeedByLanguage: { fr: 1.4 } })

    expect(resolveTtsSelection().speed).toBe(1.2)
  })

  test("unreadable settings resolve to the defaults instead of throwing", () => {
    document.documentElement.lang = "en"
    localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, "{not json")

    expect(resolveTtsSelection()).toEqual({ language: "en", voice: undefined, speed: DEFAULT_AUDIO_SETTINGS.ttsSpeed })
  })
})
