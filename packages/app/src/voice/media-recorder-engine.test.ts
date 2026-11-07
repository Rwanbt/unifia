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

function setup(options: { available?: boolean; chunks?: Blob[]; acquire?: boolean; acquireGate?: Promise<void>; onTrackStop?: () => void } = {}) {
  const recorder = new FakeRecorder()
  for (const chunk of options.chunks ?? [new Blob(["pcm"])]) recorder.emit(chunk)
  const calls: string[] = []
  const released: number[] = []
  let acquired = 0
  let cancelled = 0

  const engine = createMediaRecorderEngine({
    async acquire() {
      acquired += 1
      if (options.acquireGate) await options.acquireGate
      if (options.acquire === false) return undefined
      return {
        stream: { getTracks: () => [{ stop: () => options.onTrackStop?.() }] } as unknown as MediaStream,
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
    schedule: () => () => {},
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

  test("cancel during the acquisition closes the late stream and opens no recorder", async () => {
    let releaseGate!: () => void
    const acquireGate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let trackStopped = 0
    const { engine, recorder, released } = setup({
      acquireGate,
      onTrackStop: () => {
        trackStopped += 1
      },
    })

    const starting = engine.start()
    await engine.cancel()
    releaseGate()
    await starting

    expect(trackStopped).toBe(1)
    expect(released).toHaveLength(1)
    expect(recorder.state).toBe("inactive")
  })

  describe("provisional transcription", () => {
    function live(transcribe: (call: number) => Promise<string>) {
      const recorder = new FakeRecorder()
      const events: string[] = []
      let tick: (() => void) | undefined
      let stopped = 0
      let call = 0
      const engine = createMediaRecorderEngine({
        acquire: async () => ({
          stream: { getTracks: () => [] } as unknown as MediaStream,
          release: () => {},
        }),
        invoke: async (command) => {
          if (command === "stt_available") return true
          if (command !== "stt_transcribe") return undefined
          call += 1
          return transcribe(call)
        },
        convert: async (blob) => String(blob.size),
        createRecorder: () => recorder.asMediaRecorder(),
        schedule: (next) => {
          tick = next
          return () => {
            stopped += 1
          }
        },
      })
      engine.onPartial!((text) => events.push(`partial:${text}`))
      const speak = (word: string) => recorder.ondataavailable?.({ data: new Blob([word]) })
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
      return { engine, recorder, events, speak, flush, tick: () => tick?.(), stopped: () => stopped }
    }

    test("partials grow while recording and the final text comes last", async () => {
      const words = ["bonjour", "bonjour le", "bonjour le monde"]
      const { engine, events, speak, flush, tick, stopped } = live(async (call) => words[call - 1] ?? "")
      await engine.start()

      speak("a")
      tick()
      await flush()
      speak("b")
      tick()
      await flush()
      events.push(`final:${await engine.finish()}`)

      expect(events).toEqual(["partial:bonjour", "partial:bonjour le", "final:bonjour le monde"])
      expect(stopped()).toBe(1)
    })

    test("a partial resolving after the stop never lands after the final text", async () => {
      let releasePartial!: (text: string) => void
      const { engine, events, speak, flush, tick } = live((call) =>
        call === 1 ? new Promise<string>((resolve) => { releasePartial = resolve }) : Promise.resolve("texte final"))
      await engine.start()
      speak("a")
      tick()
      await flush()

      const finishing = engine.finish()
      releasePartial("texte")
      events.push(`final:${await finishing}`)
      await flush()

      expect(events).toEqual(["final:texte final"])
    })

    test("no new audio means no repeated transcription", async () => {
      let calls = 0
      const { engine, speak, flush, tick } = live(async () => {
        calls += 1
        return "bonjour"
      })
      await engine.start()
      speak("a")
      tick()
      await flush()
      tick()
      await flush()
      expect(calls).toBe(1)
      await engine.cancel()
    })
  })
})
