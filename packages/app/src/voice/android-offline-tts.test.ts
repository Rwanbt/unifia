/* SPDX-License-Identifier: MIT */
import { afterEach, describe, expect, test } from "bun:test"
import { AndroidOfflineTts } from "./android-offline-tts"

const originalSpeech = Object.getOwnPropertyDescriptor(globalThis, "speechSynthesis")
const originalUtterance = Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance")

function installSpeech(voice: Partial<SpeechSynthesisVoice>) {
  const utterances: FakeUtterance[] = []
  const synthesis = {
    paused: false,
    getVoices: () => [{ lang: "fr-FR", localService: true, ...voice }],
    addEventListener() {},
    removeEventListener() {},
    speak(utterance: FakeUtterance) {
      utterances.push(utterance)
      queueMicrotask(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent))
    },
    cancel() {},
    pause() { this.paused = true },
    resume() { this.paused = false },
  }
  Object.defineProperty(globalThis, "speechSynthesis", { configurable: true, value: synthesis })
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: class {
      lang = ""
      voice: SpeechSynthesisVoice | null = null
      rate = 1
      onend: ((event: SpeechSynthesisEvent) => void) | null = null
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
      constructor(readonly text: string) {}
    },
  })
  return utterances
}

class FakeUtterance {
  onend: ((event: SpeechSynthesisEvent) => void) | null = null
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
}

afterEach(() => {
  if (originalSpeech) Object.defineProperty(globalThis, "speechSynthesis", originalSpeech)
  else Reflect.deleteProperty(globalThis, "speechSynthesis")
  if (originalUtterance) Object.defineProperty(globalThis, "SpeechSynthesisUtterance", originalUtterance)
  else Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance")
})

describe("AndroidOfflineTts", () => {
  test("selects only an installed local voice and applies the requested speed", async () => {
    const utterances = installSpeech({})
    const tts = new AndroidOfflineTts()
    await tts.prepare("fr")
    await tts.speak("Bonjour", "fr", 1.4)
    expect(utterances).toHaveLength(1)
    expect((utterances[0] as unknown as { text: string }).text).toBe("Bonjour")
    expect((utterances[0] as unknown as { rate: number }).rate).toBe(1.4)
  })

  test("refuses voices that are not local", async () => {
    installSpeech({ localService: false })
    await expect(new AndroidOfflineTts().prepare("fr")).rejects.toThrow("No installed offline TTS voice")
  })
})
