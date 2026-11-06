/* SPDX-License-Identifier: MIT */

import type { DictationEngine } from "./dictation-controller"

/**
 * `DictationEngine` for the web shell.
 *
 * Wraps the browser speech recogniser behind the shared contract. The
 * recogniser is injected so the engine stays testable on the host and the shell
 * decides which constructor is available (standard or webkit-prefixed).
 *
 * An error raised while recording is not lost: the engine remembers it, signals
 * an engine-decided stop, and the controller's `finish()` rejects with the same
 * error so the shell reports it exactly once.
 */

export interface RecognitionResult {
  readonly isFinal: boolean
  readonly 0: { transcript: string }
}

export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export interface BrowserSpeechEngineOptions {
  /** Returns the recogniser, or undefined when the browser has none. */
  createRecognition(): RecognitionLike | undefined
  /** Language tag applied to every new recogniser. */
  language(): string
}

function recognitionError(code: string): Error {
  const error = new Error(code)
  if (code === "not-allowed" || code === "service-not-allowed") error.name = "NotAllowedError"
  return error
}

export function createBrowserSpeechEngine(options: BrowserSpeechEngineOptions): DictationEngine {
  let recognition: RecognitionLike | undefined
  let finalText = ""
  let finishing = false
  let pendingError: Error | undefined
  let resolveFinish: ((text: string) => void) | undefined
  let rejectFinish: ((error: unknown) => void) | undefined
  let autoStop: (() => void) | undefined
  const partials: ((text: string) => void)[] = []

  function reset(): void {
    recognition = undefined
    finishing = false
    resolveFinish = undefined
    rejectFinish = undefined
  }

  return {
    async start() {
      const created = options.createRecognition()
      if (!created) {
        const error = new Error("speech recognition unavailable")
        error.name = "NotSupportedError"
        throw error
      }
      pendingError = undefined
      finalText = ""
      finishing = false
      recognition = created
      created.lang = options.language()
      created.continuous = true
      created.interimResults = true
      created.onresult = (event) => {
        let interim = ""
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index]
          const transcript = result[0]?.transcript ?? ""
          if (result.isFinal) finalText += transcript
          else interim += transcript
        }
        if (!interim) return
        for (const listener of partials) listener(interim)
      }
      created.onerror = (event) => {
        const error = recognitionError(event.error)
        if (finishing) {
          const reject = rejectFinish
          reset()
          reject?.(error)
          return
        }
        pendingError = error
        reset()
        autoStop?.()
      }
      created.onend = () => {
        if (finishing) {
          const resolve = resolveFinish
          const text = finalText
          reset()
          resolve?.(text)
          return
        }
        reset()
        autoStop?.()
      }
      created.start()
    },

    finish() {
      if (!recognition) {
        const error = pendingError
        pendingError = undefined
        if (error) return Promise.reject(error)
        return Promise.resolve("")
      }
      finishing = true
      return new Promise<string>((resolve, reject) => {
        resolveFinish = resolve
        rejectFinish = reject
        recognition!.stop()
      })
    },

    async cancel() {
      if (!recognition) {
        pendingError = undefined
        return
      }
      const current = recognition
      reset()
      pendingError = undefined
      current.abort()
    },

    onPartial(listener) {
      partials.push(listener)
      return () => {
        const index = partials.indexOf(listener)
        if (index >= 0) partials.splice(index, 1)
      }
    },

    onAutoStop(listener) {
      autoStop = listener
      return () => {
        autoStop = undefined
      }
    },
  }
}
