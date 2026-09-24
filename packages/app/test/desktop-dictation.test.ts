/* SPDX-License-Identifier: MIT */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// Native boundaries of the desktop speech hook, replaced with deterministic
// doubles: Tauri IPC, the Tauri event bus, the microphone and the decoder.
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }))

class FakeRecorder {
  static isTypeSupported = () => true
  state: "inactive" | "recording" = "inactive"
  mimeType = "audio/webm;codecs=opus"
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void | Promise<void>) | null = null
  constructor(readonly stream: MediaStream) {
    recorders.push(this)
  }
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: this.mimeType }) })
    // Browsers fire `stop` asynchronously, after the caller returns.
    queueMicrotask(() => void this.onstop?.())
  }
}

class FakeAudioContext {
  async decodeAudioData() {
    return { sampleRate: 16000, getChannelData: () => new Float32Array(1600) }
  }
  async close() {}
}

let recorders: FakeRecorder[] = []
let transcriptions = 0
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true } }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

describe("desktop dictation hook", () => {
  let speech: typeof import("../../desktop/src/hooks/use-speech")
  let coordinator: typeof import("../src/voice/audio-capture-coordinator")
  let submitted = 0
  let editor: HTMLDivElement
  let form: HTMLFormElement

  beforeEach(async () => {
    recorders = []
    transcriptions = 0
    submitted = 0
    ;(globalThis as any).MediaRecorder = FakeRecorder
    ;(globalThis as any).AudioContext = FakeAudioContext
    ;(globalThis as any).__TAURI__ = {
      core: {
        invoke: async (command: string) => {
          if (command === "stt_available") return true
          if (command === "stt_transcribe") {
            transcriptions++
            return "Corrige l'erreur dans le module d'authentification"
          }
          if (["stt_load_model", "tts_start", "tts_cancel", "tts_cleanup_chunks"].includes(command)) return 0
          throw new Error(`unexpected command ${command}`)
        },
      },
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => fakeStream().stream },
    })
    form = document.createElement("form")
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      submitted++
    })
    editor = document.createElement("div")
    editor.setAttribute("data-component", "prompt-input")
    editor.setAttribute("contenteditable", "true")
    form.appendChild(editor)
    document.body.appendChild(form)
    ;(document as any).execCommand = (command: string, _ui: boolean, text: string) => {
      if (command === "insertText") editor.textContent = (editor.textContent ?? "") + text
      return true
    }
    speech = await import("../../desktop/src/hooks/use-speech")
    coordinator = await import("../src/voice/audio-capture-coordinator")
    speech.initSpeechListeners()
    await settle()
  })

  afterEach(() => {
    speech.cleanupSpeechListeners()
    form.remove()
  })

  test("stop inserts the transcript into the prompt and never submits", async () => {
    window.dispatchEvent(new CustomEvent("stt-start"))
    await settle()
    expect(recorders[0].state).toBe("recording")
    window.dispatchEvent(new CustomEvent("stt-stop"))
    await settle()
    expect(editor.textContent).toBe("Corrige l'erreur dans le module d'authentification")
    expect(submitted).toBe(0)
  })

  test("Live taking the microphone right after stop keeps the dictated text", async () => {
    window.dispatchEvent(new CustomEvent("stt-start"))
    await settle()
    window.dispatchEvent(new CustomEvent("stt-stop"))
    const lease = coordinator.requestAudioCapture(window, "live", () => {})
    expect(lease).toBeDefined()
    await settle()
    expect(transcriptions).toBe(1)
    expect(editor.textContent).toBe("Corrige l'erreur dans le module d'authentification")
    lease?.release()
  })

  test("Live preempting an unfinished recording discards it", async () => {
    window.dispatchEvent(new CustomEvent("stt-start"))
    await settle()
    const lease = coordinator.requestAudioCapture(window, "live", () => {})
    await settle()
    expect(transcriptions).toBe(0)
    expect(editor.textContent).toBe("")
    lease?.release()
  })
})
