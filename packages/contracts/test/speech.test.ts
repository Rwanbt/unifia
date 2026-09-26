/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createVoiceRegistry, resolveSpeechLanguage, resolveTtsProviders } from "../src/speech"
import { createVoiceError, createVoiceErrorEvent, isVoiceErrorEvent, liveVoiceErrors, voiceErrorFromEvent } from "../src/speech"

const licensedVoice = {
  id: "fr-fr-default",
  provider: "pocket" as const,
  language: "fr" as const,
  displayName: "French default",
  version: "1.0.0",
  source: "https://example.invalid/voice",
  license: "CC-BY-4.0",
  licenseSource: "https://example.invalid/license",
  redistributable: false,
}

describe("speech contracts", () => {
  test("voice errors carry a stable stage, code, safe detail and ordered event envelope", () => {
    for (const legacyCode of liveVoiceErrors) {
      const error = createVoiceError(legacyCode, 123)
      expect(error.timestamp).toBe(123)
      expect(error.code).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(error.detail.length).toBeLessThanOrEqual(240)
      const event = createVoiceErrorEvent(error, { sessionID: "ses_test", turnID: "turn_test", seq: 4 })
      expect(isVoiceErrorEvent(event)).toBe(true)
      expect(event).not.toHaveProperty("causeCategory")
    }
  })

  test("voice error event rejects mismatched stages and exposed credentials", () => {
    const base = createVoiceErrorEvent(createVoiceError("connection_lost", 123), { sessionID: "ses_test", seq: 0 })
    expect(isVoiceErrorEvent({ ...base, stage: "stt" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, detail: "Authorization: Bearer secret" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, code: "NETWORK_ANYTHING" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, provider_id: "secret value" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, sessionID: "binding_not_session" })).toBe(false)
  })

  test("voice error events map to legacy UI codes without retaining free-form detail", () => {
    const event = createVoiceErrorEvent(createVoiceError("stt_unavailable", 123), { sessionID: "ses_test", seq: 0 })
    const mapped = voiceErrorFromEvent({ ...event, detail: "untrusted transcript or provider output" })
    expect(mapped.legacyCode).toBe("stt_unavailable")
    expect(mapped.code).toBe(event.code)
    expect(mapped.detail).not.toContain("untrusted")
  })

  test("auto fallback order is stable and explicit providers stay explicit", () => {
    expect(resolveTtsProviders("auto")).toEqual(["pocket", "piper", "fallback-android-tts"])
    expect(resolveTtsProviders("piper")).toEqual(["piper"])
  })

  test("voice registry filters by language and provider", () => {
    const registry = createVoiceRegistry([licensedVoice])
    expect(registry.list("fr")).toEqual([licensedVoice])
    expect(registry.get("fr-fr-default", "fr", "pocket")).toEqual(licensedVoice)
    expect(registry.get("fr-fr-default", "en")).toBeUndefined()
  })

  test("voice registry rejects missing license metadata and duplicate IDs", () => {
    expect(() => createVoiceRegistry([{ ...licensedVoice, licenseSource: "" }])).toThrow("license metadata")
    expect(() => createVoiceRegistry([{ ...licensedVoice, source: "" }])).toThrow("license metadata")
    expect(() => createVoiceRegistry([licensedVoice, licensedVoice])).toThrow("Duplicate voice")
  })

  test("ambiguous cross-provider IDs require an explicit provider", () => {
    const piperVoice = { ...licensedVoice, provider: "piper" as const }
    const registry = createVoiceRegistry([licensedVoice, piperVoice])
    expect(registry.get(licensedVoice.id, "fr")).toBeUndefined()
    expect(registry.get(licensedVoice.id, "fr", "piper")).toEqual(piperVoice)
  })

  test("language routing follows preference, detection, conversation, locale, then English", () => {
    expect(resolveSpeechLanguage({ preference: "de", detectedLanguage: "fr" })).toBe("de")
    expect(resolveSpeechLanguage({ preference: "auto", detectedLanguage: "es" })).toBe("es")
    expect(resolveSpeechLanguage({ conversationLanguage: "it", applicationLocale: "fr-FR" })).toBe("it")
    expect(resolveSpeechLanguage({ applicationLocale: "fr-FR" })).toBe("fr")
    expect(resolveSpeechLanguage({ applicationLocale: "ja-JP" })).toBe("en")
  })

  test("short auto-detected utterances retain the previous language", () => {
    expect(resolveSpeechLanguage({
      preference: "auto",
      detectedLanguage: "en",
      previousAutomaticLanguage: "fr",
      text: "npm build",
    })).toBe("fr")
    expect(resolveSpeechLanguage({
      preference: "auto",
      detectedLanguage: "en",
      previousAutomaticLanguage: "fr",
      text: "Bonjour tout le monde",
    })).toBe("en")
  })
})
