/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createVoiceRegistry, createVoiceError, createVoiceErrorEvent, isVoiceErrorEvent, isVoiceReadyEvent, liveVoiceErrors, resolveSpeechLanguage, resolveTtsProviders, voiceErrorCodeStages, voiceErrorFromEvent, voiceErrorStages } from "../src/speech"

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
  test("voice readiness requires a valid session, sequence, and Live profile", () => {
    const base = { kind: "voice_ready", sessionID: "ses_test", ts: 123, seq: 1, profile: "live" }
    expect(isVoiceReadyEvent(base)).toBe(true)
    expect(isVoiceReadyEvent({ ...base, sessionID: "binding_test" })).toBe(false)
    expect(isVoiceReadyEvent({ ...base, seq: -1 })).toBe(false)
    expect(isVoiceReadyEvent({ ...base, ts: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
    expect(isVoiceReadyEvent({ ...base, profile: "dictation" })).toBe(false)
  })

  test("voice errors carry a stable stage, code, safe detail and ordered event envelope", () => {
    for (const legacyCode of liveVoiceErrors) {
      const error = createVoiceError(legacyCode, 123)
      expect(error.timestamp).toBe(123)
      expect(error.code).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(error.detail.length).toBeLessThanOrEqual(240)
      const event = createVoiceErrorEvent(error, { sessionID: "ses_test", turnID: "turn_test", seq: 4 })
      expect(isVoiceErrorEvent(event)).toBe(true)
      expect(event.cause_category).toBe(error.causeCategory)
    }
  })

  test("every declared error stage has at least one stable code", () => {
    const coveredStages = new Set(Object.values(voiceErrorCodeStages))
    expect([...voiceErrorStages].filter((stage) => !coveredStages.has(stage))).toEqual([])
  })

  test("voice error event rejects mismatched stages and exposed credentials", () => {
    const base = createVoiceErrorEvent(createVoiceError("connection_lost", 123), { sessionID: "ses_test", seq: 0 })
    expect(isVoiceErrorEvent({ ...base, stage: "stt" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, detail: "Authorization: Bearer secret" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, code: "NETWORK_ANYTHING" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, provider_id: "secret value" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, cause_category: "other" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, sessionID: "binding_not_session" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, ts: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
  })

  test("pre-session errors use exactly one validated Live binding identity", () => {
    const base = createVoiceErrorEvent(
      createVoiceError("binding_invalid", 123), { sessionID: "ses_test", seq: 0 },
    )
    const bindingEvent = { ...base, sessionID: undefined, bindingID: `lvb_${"1".repeat(32)}` }
    expect(isVoiceErrorEvent(bindingEvent)).toBe(true)
    expect(isVoiceErrorEvent({ ...bindingEvent, sessionID: "ses_test" })).toBe(false)
    expect(isVoiceErrorEvent({ ...base, sessionID: undefined, bindingID: "lvb_short" })).toBe(false)
  })

  test("voice error events map to legacy UI codes without retaining free-form detail", () => {
    const event = createVoiceErrorEvent(createVoiceError("stt_unavailable", 123), { sessionID: "ses_test", seq: 0 })
    const mapped = voiceErrorFromEvent({ ...event, detail: "untrusted transcript or provider output" })
    expect(mapped.legacyCode).toBe("stt_unavailable")
    expect(mapped.code).toBe(event.code)
    expect(mapped.detail).not.toContain("untrusted")
    expect(mapped.causeCategory).toBe(event.cause_category)
    expect(voiceErrorFromEvent({
      ...event,
      stage: "provider",
      code: "PROVIDER_BINDING_INVALID",
      cause_category: "provider",
    }).legacyCode).toBe("binding_invalid")
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
