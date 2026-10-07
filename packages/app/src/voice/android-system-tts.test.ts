/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import {
  clampSpeechRate,
  createSystemVoiceFallback,
  selectSystemVoice,
  SYSTEM_TTS_PROVIDER_ID,
  type SystemVoiceEngine,
} from "./android-system-tts"
import { AudioPlaybackCoordinator } from "./audio-playback-coordinator"
import { DEFAULT_AUDIO_SETTINGS, migrateAudioSettings } from "./audio-settings"

const FR = "fr" as SpeechLanguage

/** Records every call so a test can assert the engine was never touched. */
function engineWith(
  voices: readonly { lang: string; name: string; default: boolean }[],
  options: { fail?: boolean } = {},
): SystemVoiceEngine & { spoken: { text: string; lang: string; voice: string; rate: number }[]; cancels: number } {
  const spoken: { text: string; lang: string; voice: string; rate: number }[] = []
  const state = { spoken, cancels: 0 }
  return {
    get spoken() {
      return spoken
    },
    get cancels() {
      return state.cancels
    },
    voices: () => voices,
    async speak(request) {
      if (options.fail) throw new Error("system engine unavailable")
      spoken.push(request)
    },
    cancel() {
      state.cancels += 1
    },
  }
}

describe("the system-voice fallback setting (D10)", () => {
  test("is OFF by default", () => {
    expect(DEFAULT_AUDIO_SETTINGS.ttsSystemVoiceFallback).toBe(false)
    expect(migrateAudioSettings(undefined).ttsSystemVoiceFallback).toBe(false)
  })

  test("stays OFF for every record written before the setting existed", () => {
    // A record with no such key, and one whose value is anything but a real
    // boolean, must both migrate to OFF rather than to "probably on".
    expect(migrateAudioSettings({ ttsProvider: "piper", ttsSpeed: 1.25 }).ttsSystemVoiceFallback).toBe(false)
    for (const value of ["true", 1, null, {}, []]) {
      expect(migrateAudioSettings({ ttsSystemVoiceFallback: value }).ttsSystemVoiceFallback).toBe(false)
    }
  })

  test("keeps an explicit opt-in", () => {
    expect(migrateAudioSettings({ ttsSystemVoiceFallback: true }).ttsSystemVoiceFallback).toBe(true)
  })
})

describe("createSystemVoiceFallback", () => {
  test("does not touch the platform engine while disabled", async () => {
    const engine = engineWith([{ lang: "fr-FR", name: "Google français", default: true }])
    const fallback = createSystemVoiceFallback({
      enabled: false,
      engine,
      coordinator: new AudioPlaybackCoordinator(),
    })

    expect(fallback.enabled).toBe(false)
    expect(await fallback.speak("Bonjour", FR, { priority: "live", speed: 1 })).toBe(false)
    // The engine was never even asked for its voice list.
    expect(engine.spoken).toEqual([])
  })

  test("speaks through the platform voice when enabled", async () => {
    const engine = engineWith([
      { lang: "en-US", name: "Google US English", default: true },
      { lang: "fr-FR", name: "Google français", default: true },
    ])
    const fallback = createSystemVoiceFallback({
      enabled: true,
      engine,
      coordinator: new AudioPlaybackCoordinator(),
    })

    expect(await fallback.speak("  Bonjour  ", FR, { priority: "live", speed: 1.4 })).toBe(true)
    expect(engine.spoken).toEqual([
      { text: "Bonjour", lang: "fr-FR", voice: "Google français", rate: 1.4 },
    ])
  })

  test("stays silent when the device has no local voice for the language", async () => {
    const engine = engineWith([{ lang: "en-US", name: "Google US English", default: true }])
    const fallback = createSystemVoiceFallback({
      enabled: true,
      engine,
      coordinator: new AudioPlaybackCoordinator(),
    })

    expect(await fallback.speak("Bonjour", FR, { priority: "live", speed: 1 })).toBe(false)
    expect(engine.spoken).toEqual([])
  })

  test("reports a failed platform engine as a failed fallback, not as speech", async () => {
    const engine = engineWith([{ lang: "fr-FR", name: "Google français", default: true }], { fail: true })
    const fallback = createSystemVoiceFallback({
      enabled: true,
      engine,
      coordinator: new AudioPlaybackCoordinator(),
    })

    expect(await fallback.speak("Bonjour", FR, { priority: "live", speed: 1 })).toBe(false)
  })

  test("refuses empty text and releases its lease afterwards", async () => {
    const engine = engineWith([{ lang: "fr-FR", name: "Google français", default: true }])
    const coordinator = new AudioPlaybackCoordinator()
    const fallback = createSystemVoiceFallback({ enabled: true, engine, coordinator })

    expect(await fallback.speak("   ", FR, { priority: "live", speed: 1 })).toBe(false)
    expect(await fallback.speak("Bonjour", FR, { priority: "live", speed: 1 })).toBe(true)
    // The lease was released, so a higher priority can still acquire.
    expect(coordinator.acquire("live", () => {})).toBeDefined()
  })

  test("a Live utterance preempts a fallback that is already speaking", async () => {
    let releaseSpeaking = () => {}
    const engine: SystemVoiceEngine = {
      voices: () => [{ lang: "fr-FR", name: "Google français", default: true }],
      speak: () => new Promise<void>((resolve) => { releaseSpeaking = resolve }),
      cancel: () => releaseSpeaking(),
    }
    const coordinator = new AudioPlaybackCoordinator()
    const fallback = createSystemVoiceFallback({ enabled: true, engine, coordinator })

    const speaking = fallback.speak("Bonjour", FR, { priority: "manual", speed: 1 })
    const preempted = coordinator.acquire("live", () => {})

    expect(preempted).toBeDefined()
    expect(await speaking).toBe(true)
  })
})

describe("selectSystemVoice", () => {
  const voices = [
    { lang: "fr-FR", name: "Google français", default: true },
    { lang: "fr-CA", name: "Google français (CA)", default: false },
    { lang: "en-US", name: "Google US English", default: true },
  ]

  test("prefers an exact voice name when the device installed it", () => {
    expect(selectSystemVoice(voices, FR, "Google français (CA)")).toEqual({
      lang: "fr-CA",
      name: "Google français (CA)",
    })
  })

  test("falls back to the default local voice for the language", () => {
    expect(selectSystemVoice(voices, FR)).toEqual({ lang: "fr-FR", name: "Google français" })
  })

  test("ignores a requested voice the device does not have", () => {
    expect(selectSystemVoice(voices, FR, "Not installed")).toEqual({
      lang: "fr-FR",
      name: "Google français",
    })
  })

  test("returns nothing for a language with no local voice", () => {
    expect(selectSystemVoice(voices, "de" as SpeechLanguage)).toBeUndefined()
    expect(selectSystemVoice([], FR)).toBeUndefined()
  })
})

describe("clampSpeechRate", () => {
  test("keeps a usable rate and clamps the rest", () => {
    expect(clampSpeechRate(1)).toBe(1)
    expect(clampSpeechRate(0)).toBe(0.1)
    expect(clampSpeechRate(99)).toBe(10)
    expect(clampSpeechRate(Number.NaN)).toBe(1)
  })
})

describe("the provider id the fallback reports", () => {
  test("is the reserved contract id and never Pocket", () => {
    // The whole point of D10 is that a system voice is never presented as the
    // local neural voice, so this is asserted rather than left to review.
    expect(SYSTEM_TTS_PROVIDER_ID).toBe("fallback-android-tts")
    expect(SYSTEM_TTS_PROVIDER_ID).not.toBe("pocket")
  })
})