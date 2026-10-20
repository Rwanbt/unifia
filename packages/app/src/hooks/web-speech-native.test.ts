/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import type { NativeDictation } from "./native-dictation"
import { installWebSpeech, type SpeechEndDetail } from "./web-speech"

type Scope = Record<string, unknown>
const scope = window as unknown as Scope
const cleanups: (() => void)[] = []
const savedRecognition = scope.SpeechRecognition

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  scope.SpeechRecognition = savedRecognition
  document.body.innerHTML = ""
})

const ended = () => {
  const seen: SpeechEndDetail[] = []
  const listener = (event: Event) => seen.push((event as CustomEvent<SpeechEndDetail>).detail)
  window.addEventListener("speech-ended", listener)
  cleanups.push(() => window.removeEventListener("speech-ended", listener))
  return seen
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("installWebSpeech with the native dictation", () => {
  test("dictation uses the native engine and never the browser recognizer", async () => {
    let browserRecognizerCreated = 0
    scope.SpeechRecognition = class {
      constructor() {
        browserRecognizerCreated++
      }
    }
    let started = 0
    const native: NativeDictation = {
      start: async () => {
        started++
      },
      finish: async () => "bonjour",
    }
    const seen = ended()
    cleanups.push(installWebSpeech(window, { nativeDictation: native }))

    window.dispatchEvent(new CustomEvent("stt-start"))
    await settle()
    expect(started).toBe(1)

    window.dispatchEvent(new CustomEvent("stt-stop"))
    await settle()
    expect(seen).toEqual([{ kind: "stt", reason: "done" }])
    expect(browserRecognizerCreated).toBe(0)
  })

  test("a native start failure is reported as a speech error", async () => {
    const native: NativeDictation = {
      start: async () => {
        throw new Error("Android audio is busy")
      },
      finish: async () => "",
    }
    const seen = ended()
    cleanups.push(installWebSpeech(window, { nativeDictation: native }))

    window.dispatchEvent(new CustomEvent("stt-start"))
    await settle()
    expect(seen).toEqual([{ kind: "stt", reason: "error" }])
  })

  test("a native transcription failure is reported as a speech error", async () => {
    const native: NativeDictation = {
      start: async () => undefined,
      finish: async () => {
        throw new Error("Parakeet unavailable")
      },
    }
    const seen = ended()
    cleanups.push(installWebSpeech(window, { nativeDictation: native }))

    window.dispatchEvent(new CustomEvent("stt-start"))
    await settle()
    window.dispatchEvent(new CustomEvent("stt-stop"))
    await settle()
    expect(seen).toEqual([{ kind: "stt", reason: "error" }])
  })
})
