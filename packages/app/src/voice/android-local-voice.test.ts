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
        return {
          speaking: pollCount === 1,
          utterance_id: pollCount === 1 ? "41" : null,
          audio_clock_ms: 20,
          sample_rate: 48_000,
          frames_per_burst: 192,
          xrun_count: 0,
          last_error: 0,
          capture_overflows: 0,
          playback_overflows: 0,
          playback_empty_samples: 0,
        }
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

  test("requests native audio closure when polling fails before reporting the error", async () => {
    installLocalSpeech()
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    })
    let rejectPoll!: (error: Error) => void
    const pollFailure = new Promise<never>((_, reject) => { rejectPoll = reject })
    let resolveClosed!: () => void
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
    const commands: string[] = []
    const events: string[] = []
    const invoke = async (command: string) => {
      commands.push(command)
      if (command === "stt_available") return true
      if (command === "voice_audio_poll") return pollFailure
      if (command === "voice_audio_close") {
        events.push("close")
        resolveClosed()
      }
      return null
    }
    const transport = createAndroidLocalVoiceTransport(invoke)
    let reportedError: unknown

    await transport.start({
      onSpeaking() {},
      onUtterance() {},
      onError(error) {
        events.push("error")
        reportedError = error
      },
    })
    rejectPoll(new Error("Oboe audio stream failed"))
    await closed

    expect(commands).toContain("voice_audio_close")
    expect(events).toEqual(["close", "error"])
    expect(reportedError).toBeInstanceOf(Error)
    transport.stop()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
