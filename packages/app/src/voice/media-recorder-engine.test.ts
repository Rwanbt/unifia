/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createMediaRecorderEngine } from "./media-recorder-engine"

class FakeRecorder {
  state: RecordingState = "inactive"
  mimeType = "audio/webm"
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  private pending: Blob[] = []

  start(_timeslice?: number): void {
    this.state = "recording"
  }

  stop(): void {
    this.state = "inactive"
    for (const chunk of this.pending) this.ondataavailable?.({ data: chunk })
    this.onstop?.()
  }

  emit(chunk: Blob): void {
    this.pending.push(chunk)
  }

  asMediaRecorder(): MediaRecorder {
    return this as unknown as MediaRecorder
  }
}

function setup(options: { available?: boolean; chunks?: Blob[]; acquire?: boolean } = {}) {
  const recorder = new FakeRecorder()
  for (const chunk of options.chunks ?? [new Blob(["pcm"])]) recorder.emit(chunk)
  const calls: string[] = []
  const released: number[] = []
  let acquired = 0
  let cancelled = 0

  const engine = createMediaRecorderEngine({
    async acquire() {
      acquired += 1
      if (options.acquire === false) return undefined
      return {
        stream: {} as MediaStream,
        release: () => released.push(1),
      }
    },
    cancelCapture: () => {
      cancelled += 1
    },
    async invoke(command, args) {
      calls.push(args ? `${command}:${JSON.stringify(args)}` : command)
      if (command === "stt_available") return options.available ?? true
      if (command === "stt_transcribe") return "bonjour le monde"
      return undefined
    },
    async convert() {
      return "BASE64"
    },
    createRecorder: () => recorder.asMediaRecorder(),
  })

  return { engine, recorder, calls, released, cancelled: () => cancelled, acquired: () => acquired }
}

describe("media recorder engine", () => {
  test("start acquires the microphone and records", async () => {
    const { engine, recorder, acquired } = setup()
    await engine.start()
    expect(acquired()).toBe(1)
    expect(recorder.state).toBe("recording")
  })

  test("a refused capture throws", async () => {
    const { engine } = setup({ acquire: false })
    await expect(engine.start()).rejects.toThrow("microphone capture unavailable")
  })

  test("finish converts and transcribes", async () => {
    const { engine, calls, released } = setup()
    await engine.start()

    expect(await engine.finish()).toBe("bonjour le monde")
    expect(calls).toEqual([
      "stt_available",
      'stt_transcribe:{"audioBase64":"BASE64"}',
    ])
    expect(released).toHaveLength(1)
  })

  test("finish downloads the model when it is missing", async () => {
    const { engine, calls } = setup({ available: false })
    await engine.start()

    await engine.finish()
    expect(calls).toEqual([
      "stt_available",
      "stt_download_model",
      'stt_transcribe:{"audioBase64":"BASE64"}',
    ])
  })

  test("finish without recorded audio returns an empty transcript", async () => {
    const { engine, calls } = setup({ chunks: [] })
    await engine.start()

    expect(await engine.finish()).toBe("")
    expect(calls).toEqual([])
  })

  test("cancel releases the capture without transcribing", async () => {
    const { engine, calls, released, cancelled } = setup()
    await engine.start()

    await engine.cancel()
    expect(calls).toEqual([])
    expect(released).toHaveLength(1)
    expect(cancelled()).toBe(1)
    expect(await engine.finish()).toBe("")
  })
})
