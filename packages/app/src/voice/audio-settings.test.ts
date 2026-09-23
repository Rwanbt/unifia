import { describe, expect, test } from "bun:test"
import { DEFAULT_AUDIO_SETTINGS, migrateAudioSettings, serializeAudioSettings } from "./audio-settings"

describe("migrateAudioSettings", () => {
  test("upgrades legacy settings and removes Kokoro-only selections", () => {
    const settings = migrateAudioSettings({
      sttEngine: "parakeet",
      sttLanguage: "fr",
      ttsProvider: "kokoro",
      ttsVoice: "af_heart",
      ttsSpeed: 1.25,
    })

    expect(settings).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      sttLanguage: "fr",
      ttsSpeed: 1.25,
      voiceByLanguage: {},
    })
    expect(settings).not.toHaveProperty("ttsVoice")
    expect(settings).not.toHaveProperty("sttEngine")
  })

  test("retains valid v2 preferences and clamps invalid speed", () => {
    const settings = migrateAudioSettings({
      version: 2,
      ttsProvider: "piper",
      ttsSpeed: 9,
      voiceByLanguage: { fr: "fr_voice", xx: "unknown", en: " " },
      liveEnabled: true,
      voiceHostMode: "lan",
      cpuProfile: "fast",
    })

    expect(settings.ttsProvider).toBe("piper")
    expect(settings.ttsSpeed).toBe(2)
    expect(settings.voiceByLanguage).toEqual({ fr: "fr_voice" })
    expect(settings.liveEnabled).toBe(true)
    expect(settings.voiceHostMode).toBe("lan")
    expect(settings.cpuProfile).toBe("fast")
  })

  test("serializes only normalized v2 settings", () => {
    expect(JSON.parse(serializeAudioSettings({ ...DEFAULT_AUDIO_SETTINGS, ttsProvider: "auto" }))).toEqual(
      DEFAULT_AUDIO_SETTINGS,
    )
  })
})
