/* SPDX-License-Identifier: MIT */
import { afterEach, describe, expect, test } from "bun:test"
import { createAndroidLocalVoiceTransport } from "./android-local-voice"

const originalSpeech = Object.getOwnPropertyDescriptor(globalThis, "speechSynthesis")
const originalUtterance = Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance")
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices")

function installLocalSpeech() {
  Object.defineProperty(globalThis, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [{ lang: "en-US", localService: true }],
      addEventListener() {},
      removeEventListener() {},
      speak(utterance: { onend?: (event: SpeechSynthesisEvent) => void }) {
        queueMicrotask(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent))
      },
      cancel() {},
    },
  })
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
}

afterEach(() => {
  if (originalSpeech) Object.defineProperty(globalThis, "speechSynthesis", originalSpeech)
  else Reflect.deleteProperty(globalThis, "speechSynthesis")
  if (originalUtterance) Object.defineProperty(globalThis, "SpeechSynthesisUtterance", originalUtterance)
  else Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance")
  if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices)
  else Reflect.deleteProperty(navigator, "mediaDevices")
})

describe("Android native Live audio transport", () => {
  test("uses the WebView stream only for permission and sends utterance IDs to native STT", async () => {
    installLocalSpeech()
    let trackStops = 0
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => { trackStops++ } }] }),
      },
    })
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = []
    let pollCount = 0
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      commands.push({ command, args })
      if (command === "stt_available") return true
      if (command === "voice_audio_poll") {
        pollCount++
        return { speaking: pollCount === 1, utterance_id: pollCount === 1 ? "41" : null, audio_clock_ms: 20 }
      }
      if (command === "voice_audio_transcribe_utterance") return "Hello"
      return null
    }
    const transport = createAndroidLocalVoiceTransport(invoke)
    let utteranceID = ""
    let speakingTransitions = 0
    await transport.start({
      onSpeaking: () => { speakingTransitions++ },
      onUtterance: (id) => { utteranceID = id },
    })
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(utteranceID).toBe("41")
    expect(speakingTransitions).toBe(2)
    expect(trackStops).toBe(1)
    expect(commands.map(({ command }) => command)).toContain("voice_audio_open")
    expect(commands.map(({ command }) => command)).toContain("voice_audio_poll")
    expect(commands.map(({ command }) => command)).not.toContain("stt_transcribe")
    expect(await transport.transcribe(utteranceID)).toBe("Hello")
    expect(commands.at(-1)).toEqual({
      command: "voice_audio_transcribe_utterance",
      args: { utteranceId: "41" },
    })
    transport.stop()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
