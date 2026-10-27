/* SPDX-License-Identifier: MIT */

import type { DictationEngine } from "./dictation-controller"

/**
 * `DictationEngine` for shells that record in the browser and transcribe
 * natively.
 *
 * The desktop hook used to inline this pipeline: acquire the microphone through
 * the capture coordinator, record with MediaRecorder, convert to WAV, ask the
 * native side to download the model if needed, then transcribe. Only the
 * lifecycle was shared with the other shells, so the pipeline lives here behind
 * the engine interface and the hook keeps the wiring.
 */

export interface RecorderSource {
  stream: MediaStream
  /** Releases the capture lease held by the coordinator. */
  release(): void
}

export interface MediaRecorderEngineOptions {
  /** Acquires the microphone; resolves undefined when the capture is refused. */
  acquire(): Promise<RecorderSource | undefined>
  /** Tells the capture coordinator the request is over. */
  cancelCapture?(): void
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
  /** Converts the recorded blob to base64 WAV; the shell supplies the shared conversion. */
  convert(blob: Blob): Promise<string>
  /** Injectable for tests; defaults to a MediaRecorder with the best codec. */
  createRecorder?(stream: MediaStream): MediaRecorder
}

const TIMESLICE_MS = 250

function defaultRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm"
  return new MediaRecorder(stream, { mimeType })
}

export function createMediaRecorderEngine(options: MediaRecorderEngineOptions): DictationEngine {
  let recorder: MediaRecorder | undefined
  let source: RecorderSource | undefined
  let chunks: Blob[] = []
  let cancelled = false
  let resolveStop: ((blob: Blob | undefined) => void) | undefined

  function stopRecorder(): Promise<Blob | undefined> {
    if (!recorder || recorder.state === "inactive") return Promise.resolve(undefined)
    return new Promise((resolve) => {
      resolveStop = resolve
      recorder!.onstop = () => {
        const blob = cancelled || chunks.length === 0
          ? undefined
          : new Blob(chunks, { type: recorder!.mimeType })
        chunks = []
        recorder = undefined
        source?.release()
        source = undefined
        resolveStop?.(blob)
        resolveStop = undefined
      }
      recorder!.stop()
    })
  }

  return {
    async start() {
      cancelled = false
      const acquired = await options.acquire()
      if (!acquired) throw new Error("microphone capture unavailable")
      // A cancel can arrive while the microphone is being acquired; the stream
      // that arrives late is closed here, before any recorder exists.
      if (cancelled) {
        acquired.stream.getTracks().forEach((track) => track.stop())
        acquired.release()
        return
      }
      source = acquired
      chunks = []
      const create = options.createRecorder ?? defaultRecorder
      const created = create(acquired.stream)
      recorder = created
      created.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      created.start(TIMESLICE_MS)
    },

    async finish() {
      const blob = await stopRecorder()
      if (!blob) return ""
      const available = await options.invoke("stt_available")
      if (!available) await options.invoke("stt_download_model")
      const wavBase64 = await options.convert(blob)
      const text = await options.invoke("stt_transcribe", { audioBase64: wavBase64 })
      return typeof text === "string" ? text : ""
    },

    async cancel() {
      cancelled = true
      await stopRecorder()
      options.cancelCapture?.()
    },
  }
}
