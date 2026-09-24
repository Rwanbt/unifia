/* SPDX-License-Identifier: MIT */
import { afterEach, describe, expect, mock, test } from "bun:test"

const invokedCommands: string[] = []
let transcription = "bonjour depuis le microphone"

mock.module("../src/hooks/speech-tauri-adapter", () => ({
  invokeTauri: async (command: string) => {
    invokedCommands.push(command)
    if (command === "stt_available") return true
    if (command === "stt_transcribe") return transcription
    return undefined
  },
  convertFileSrc: (path: string) => path,
}))
mock.module("../src/voice/audio-settings", () => ({
  loadAudioSettings: () => ({ ttsProvider: "piper" }),
}))
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }))
mock.module("@unifia/ui/toast", () => ({
  showToast: () => undefined,
  toaster: { dismiss: () => undefined },
}))

const { cleanupSpeechListeners, initSpeechListeners } = await import("../../desktop/src/hooks/use-speech")
const { requestAudioCapture } = await import("../src/voice/audio-capture-coordinator")

type RecorderLike = {
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  state: "inactive" | "recording"
  start(): void
  stop(): void
}

let recorder: RecorderLike | undefined
const saved = {
  mediaRecorder: globalThis.MediaRecorder,
  audioContext: globalThis.AudioContext,
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
  execCommand: document.execCommand,
  consoleError: console.error,
}
const speechEndedCleanups: Array<() => void> = []

class FakeMediaRecorder implements RecorderLike {
  static isTypeSupported() {
    return true
  }
  mimeType = "audio/webm;codecs=opus"
  ondataavailable: RecorderLike["ondataavailable"] = null
  onstop: RecorderLike["onstop"] = null
  state: RecorderLike["state"] = "inactive"

  constructor(_stream: MediaStream) {
    recorder = this
  }

  start() {
    this.state = "recording"
  }

  stop() {
    this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) })
    this.state = "inactive"
    this.onstop?.()
  }
}

class FakeAudioContext {
  decodeAudioData() {
    return Promise.resolve({
      sampleRate: 16000,
      getChannelData: () => new Float32Array([0.1, -0.1]),
    } as unknown as AudioBuffer)
  }
  close() {
    return Promise.resolve()
  }
}

function setMicrophone(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
}

function makeStream(onTrackStop: () => void = () => undefined) {
  return {
    getTracks: () => [{ stop: onTrackStop }],
  } as unknown as MediaStream
}

async function settleAsyncWork() {
  for (let step = 0; step < 12; step++) await Promise.resolve()
}

function collectSpeechEnded() {
  const events: unknown[] = []
  const listener = (event: Event) => events.push((event as CustomEvent).detail)
  window.addEventListener("speech-ended", listener)
  speechEndedCleanups.push(() => window.removeEventListener("speech-ended", listener))
  return events
}

afterEach(() => {
  while (speechEndedCleanups.length) speechEndedCleanups.pop()?.()
  cleanupSpeechListeners()
  recorder = undefined
  invokedCommands.length = 0
  document.body.innerHTML = ""
  globalThis.MediaRecorder = saved.mediaRecorder
  globalThis.AudioContext = saved.audioContext
  document.execCommand = saved.execCommand
  console.error = saved.consoleError
  if (saved.mediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", saved.mediaDevices)
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices")
  }
})

describe("desktop dictation hook", () => {
  test("transcribes into the existing draft without submitting it", async () => {
    invokedCommands.length = 0
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    const stream = makeStream()
    setMicrophone(async () => stream)
    document.body.innerHTML = `<form><div data-component="prompt-input" contenteditable="true">draft avant dictée</div></form>`
    const editor = document.querySelector<HTMLElement>("[data-component='prompt-input']")!
    let submitCount = 0
    document.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault()
      submitCount++
    })
    document.execCommand = ((command: string, _showUi: boolean, value: string) => {
      if (command === "insertText") editor.textContent += value
      return true
    }) as typeof document.execCommand
    const ended = collectSpeechEnded()
    initSpeechListeners()

    window.dispatchEvent(new CustomEvent("stt-start"))
    await settleAsyncWork()
    expect(recorder?.state).toBe("recording")
    window.dispatchEvent(new CustomEvent("stt-stop"))
    await settleAsyncWork()

    expect(invokedCommands).toContain("stt_transcribe")
    expect(editor.textContent).toBe("draft avant dictéebonjour depuis le microphone")
    expect(submitCount).toBe(0)
    expect(ended).toHaveLength(0)
  })

  test("reports a denied microphone permission and does not start recording", async () => {
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder
    setMicrophone(async () => {
      throw Object.assign(new Error("permission denied"), { name: "NotAllowedError" })
    })
    const ended = collectSpeechEnded()
    const errors: unknown[][] = []
    console.error = (...values: unknown[]) => errors.push(values)
    initSpeechListeners()

    window.dispatchEvent(new CustomEvent("stt-start"))
    await settleAsyncWork()

    expect(ended).toEqual([{ kind: "stt", reason: "denied" }])
    expect(recorder).toBeUndefined()
    expect(invokedCommands).not.toContain("stt_transcribe")
    expect(errors).toHaveLength(1)
  })

  test("stopping during permission acquisition closes the late microphone stream", async () => {
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder
    let resolveStream!: (stream: MediaStream) => void
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    })
    setMicrophone(() => pendingStream)
    let trackStopped = false
    initSpeechListeners()

    window.dispatchEvent(new CustomEvent("stt-start"))
    window.dispatchEvent(new CustomEvent("stt-stop"))
    resolveStream(makeStream(() => { trackStopped = true }))
    await settleAsyncWork()

    expect(trackStopped).toBe(true)
    expect(recorder).toBeUndefined()
  })

  // Browsers fire a recorder's `stop` event after stop() returns; Live can
  // take the microphone in between.
  class AsyncStopRecorder extends FakeMediaRecorder {
    override stop() {
      this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) })
      this.state = "inactive"
      queueMicrotask(() => this.onstop?.())
    }
  }

  function dictationEditor() {
    globalThis.MediaRecorder = AsyncStopRecorder as unknown as typeof MediaRecorder
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    setMicrophone(async () => makeStream())
    document.body.innerHTML = `<form><div data-component="prompt-input" contenteditable="true"></div></form>`
    const editor = document.querySelector<HTMLElement>("[data-component='prompt-input']")!
    document.execCommand = ((command: string, _showUi: boolean, value: string) => {
      if (command === "insertText") editor.textContent += value
      return true
    }) as typeof document.execCommand
    initSpeechListeners()
    return editor
  }

  test("Live taking the microphone right after stop keeps the dictated text", async () => {
    const editor = dictationEditor()
    window.dispatchEvent(new CustomEvent("stt-start"))
    await settleAsyncWork()
    window.dispatchEvent(new CustomEvent("stt-stop"))
    const lease = requestAudioCapture(window, "live", () => undefined)
    expect(lease).toBeDefined()
    await settleAsyncWork()
    expect(invokedCommands).toContain("stt_transcribe")
    expect(editor.textContent).toBe("bonjour depuis le microphone")
    lease?.release()
  })

  test("Live preempting an unfinished recording discards it", async () => {
    const editor = dictationEditor()
    window.dispatchEvent(new CustomEvent("stt-start"))
    await settleAsyncWork()
    const lease = requestAudioCapture(window, "live", () => undefined)
    await settleAsyncWork()
    expect(invokedCommands).not.toContain("stt_transcribe")
    expect(editor.textContent).toBe("")
    lease?.release()
  })
})
