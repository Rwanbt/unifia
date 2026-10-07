/* SPDX-License-Identifier: MIT */
/**
 * System-voice fallback (owner decision D10, 2026-10-05).
 *
 * D10: the platform's own TTS is available as a *setting*, OFF by default,
 * and Pocket stays the local voice. This module is that setting's only
 * implementation, and it is deliberately built so that OFF is the state with
 * no code path at all: `createSystemVoiceFallback({ enabled: false })` hands
 * back an object whose `speak` resolves `false` without touching the
 * platform engine, so the default install never speaks through Google TTS.
 *
 * WHY THIS IS NOT A `TtsBackend`. The canonical router
 * (`tts-router.ts`) streams `TtsAudioChunk` PCM into the native Oboe ring,
 * and the platform voice cannot be piped there: `speechSynthesis` renders
 * straight to the device's audio output and exposes no PCM. Registering this
 * as a backend would mean yielding empty or invented chunks, which is the
 * exact fake-PCM failure the router's `productionReady` flag exists to
 * prevent. So the fallback sits *after* routing, and it runs only once the
 * router has honestly reported that no local neural voice produced audio.
 *
 * WHY IT IS NOT REPORTED AS POCKET. `speak` resolves the provider id
 * `fallback-android-tts`, which is a distinct contract id. The caller reports
 * that verbatim, so a system voice can never be counted as a Pocket
 * synthesis in the audio diagnostics.
 *
 * REMOTE VOICES ARE REFUSED. Only `localService` voices are eligible, the
 * same rule `hooks/web-speech.ts` already applies on the web path: a
 * remote-capable system voice can send the text off the device, so choosing
 * one here would be a silent cloud redirect behind a local-only router.
 */

import type { SpeechLanguage } from "@unifia/contracts/speech"
import type { AudioPlaybackCoordinator, AudioPlaybackLease, AudioPlaybackPriority } from "./audio-playback-coordinator"

/** Contract provider id reserved for the platform voice. Never `pocket`. */
export const SYSTEM_TTS_PROVIDER_ID = "fallback-android-tts" as const

/** Web Speech maps `rate` onto this range; anything outside it is clamped. */
const RATE_RANGE = { min: 0.1, max: 10 } as const

/** Narrow port so the fallback can be driven without a real engine. */
export interface SystemVoiceEngine {
  /** Installed **local** voices, as `{ lang, name, default }`. */
  voices(): readonly { lang: string; name: string; default: boolean }[]
  speak(request: { text: string; lang: string; voice: string; rate: number }): Promise<void>
  cancel(): void
}

export interface SystemVoiceFallback {
  /** Mirrors the setting, so a caller can log the decision without re-reading it. */
  readonly enabled: boolean
  /** Resolves true only when the platform actually spoke. */
  speak(
    text: string,
    language: SpeechLanguage,
    options: { priority: AudioPlaybackPriority; speed: number; voice?: string },
  ): Promise<boolean>
}

export interface SystemVoiceFallbackOptions {
  readonly enabled: boolean
  readonly engine: SystemVoiceEngine
  readonly coordinator: AudioPlaybackCoordinator
}

/**
 * Picks the voice: an exact `voice` match first, otherwise the default
 * installed local voice whose language matches. Returns undefined when the
 * device has no local voice for the language — an unhandled language must
 * stay silent rather than fall through to any voice at all.
 */
export function selectSystemVoice(
  voices: readonly { lang: string; name: string; default: boolean }[],
  language: SpeechLanguage,
  voice?: string,
): { lang: string; name: string } | undefined {
  const wanted = voice?.trim()
  if (wanted) {
    const exact = voices.find((candidate) => candidate.name === wanted)
    if (exact) return { lang: exact.lang, name: exact.name }
  }
  const matches = voices
    .filter((candidate) => candidate.lang.toLowerCase().startsWith(language.toLowerCase()))
    .sort((left, right) => Number(right.default) - Number(left.default))
  const chosen = matches[0]
  return chosen ? { lang: chosen.lang, name: chosen.name } : undefined
}

export function clampSpeechRate(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.min(RATE_RANGE.max, Math.max(RATE_RANGE.min, speed))
}

export function createSystemVoiceFallback(options: SystemVoiceFallbackOptions): SystemVoiceFallback {
  return {
    enabled: options.enabled,

    async speak(text, language, { priority, speed, voice }) {
      // OFF by default. No engine access, no voice lookup, no speech.
      if (!options.enabled) return false
      const trimmed = text.trim()
      if (!trimmed) return false

      const selected = selectSystemVoice(options.engine.voices(), language, voice)
      if (!selected) return false

      // The fallback takes the same arbitration lease the router's playback
      // uses, so a manual read-aloud cannot talk over Live and Live stops it.
      let lease: AudioPlaybackLease | undefined
      try {
        lease = options.coordinator.acquire(priority, () => options.engine.cancel())
        if (!lease) return false
        await options.engine.speak({
          text: trimmed,
          lang: selected.lang,
          voice: selected.name,
          rate: clampSpeechRate(speed),
        })
        return true
      } catch {
        // A platform engine that throws is a failed fallback, not a reason to
        // report a voice that never spoke.
        return false
      } finally {
        if (lease) options.coordinator.release(lease)
      }
    },
  }
}

/**
 * The real Web Speech engine, restricted to locally installed voices.
 *
 * `voices` is read on every call rather than cached: the platform voice list
 * arrives asynchronously after first paint, so a cached empty snapshot would
 * read as "no system voice" forever.
 */
export function createWebSpeechSystemVoiceEngine(
  win: Pick<Window, "speechSynthesis"> & typeof globalThis = globalThis as never,
): SystemVoiceEngine {
  const synth = win.speechSynthesis
  return {
    voices: () =>
      (synth?.getVoices() ?? [])
        .filter((voice) => voice.localService)
        .map((voice) => ({ lang: voice.lang, name: voice.name, default: voice.default })),

    async speak({ text, lang, voice, rate }) {
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        throw new Error("no system speech synthesis engine")
      }
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang
      const installed = synth.getVoices().find((candidate) => candidate.name === voice)
      if (installed) utterance.voice = installed
      utterance.rate = rate
      await new Promise<void>((resolve, reject) => {
        utterance.onend = () => resolve()
        utterance.onerror = (event) => reject(new Error(event.error || "system speech failed"))
        synth.speak(utterance)
      })
    },

    cancel: () => synth?.cancel(),
  }
}