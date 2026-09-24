/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, serializeAudioSettings } from "../voice/audio-settings"
import { installWebSpeech, speakableText, type SpeechEndDetail } from "./web-speech"

type Scope = Record<string, unknown>
const scope = window as unknown as Scope
const cleanups: (() => void)[] = []
const saved = { SpeechRecognition: scope.SpeechRecognition, speechSynthesis: scope.speechSynthesis }

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  scope.SpeechRecognition = saved.SpeechRecognition
  Object.defineProperty(window, "speechSynthesis", { value: saved.speechSynthesis, configurable: true })
  document.body.innerHTML = ""
})

const ended = () => {
  const seen: SpeechEndDetail[] = []
  const listener = (event: Event) => seen.push((event as CustomEvent<SpeechEndDetail>).detail)
  window.addEventListener("speech-ended", listener)
  cleanups.push(() => window.removeEventListener("speech-ended", listener))
  return seen
}

const install = () => cleanups.push(installWebSpeech(window))

describe("speakableText", () => {
  test("drops code blocks and markdown marks, keeps link text", () => {
    expect(speakableText("## Titre\n- **Build** lance `bun`\n```ts\nconst x = 1\n```\nVoir [la doc](https://x.y).")).toBe(
      "Titre Build lance bun Voir la doc.",
    )
  })
})

describe("dictation", () => {
  test("without browser support the composer is told, and nothing is started", () => {
    delete scope.SpeechRecognition
    delete scope.webkitSpeechRecognition
    const seen = ended()
    install()
    window.dispatchEvent(new CustomEvent("stt-start"))
    expect(seen).toEqual([{ kind: "stt", reason: "unsupported" }])
  })

  test("final results are inserted in the composer when dictation stops", () => {
    let instance: any
    scope.SpeechRecognition = class {
      lang = ""
      continuous = false
      interimResults = true
      onresult: any = null
      onerror: any = null
      onend: any = null
      constructor() {
        instance = this
      }
      start() {}
      stop() {
        this.onend?.()
      }
    }
    document.documentElement.lang = "fr"
    document.body.innerHTML = `<div data-component="prompt-input" contenteditable="true"></div>`
    const inserted: string[] = []
    const exec = document.execCommand
    document.execCommand = ((_command: string, _ui: boolean, value: string) => {
      inserted.push(value)
      return true
    }) as never
    cleanups.push(() => (document.execCommand = exec))
    const seen = ended()
    install()

    window.dispatchEvent(new CustomEvent("stt-start"))
    expect(instance.lang).toBe("fr")
    expect(instance.continuous).toBe(true)
    instance.onresult({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: "bonjour " } },
        { isFinal: false, 0: { transcript: "ignoré" } },
      ],
    })
    instance.onresult({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "x" } }, { isFinal: true, 0: { transcript: "le monde" } }] })
    window.dispatchEvent(new CustomEvent("stt-stop"))

    expect(inserted).toEqual(["bonjour le monde"])
    expect(seen).toEqual([{ kind: "stt", reason: "done" }])
  })

  test("a refused microphone is reported as denied", () => {
    let instance: any
    scope.SpeechRecognition = class {
      onresult: any = null
      onerror: any = null
      onend: any = null
      constructor() {
        instance = this
      }
      start() {}
      stop() {}
    }
    const seen = ended()
    install()
    window.dispatchEvent(new CustomEvent("stt-start"))
    instance.onerror({ error: "not-allowed" })
    instance.onend()
    expect(seen).toEqual([{ kind: "stt", reason: "denied" }])
  })
})

describe("read aloud", () => {
  test("speaks the cleaned text, then pauses, resumes, and a double click cancels", () => {
    const calls: string[] = []
    const synth = {
      speaking: false,
      paused: false,
      speak: (utterance: { text: string }) => {
        calls.push(`speak:${utterance.text}`)
        synth.speaking = true
      },
      pause: () => {
        calls.push("pause")
        synth.paused = true
      },
      resume: () => {
        calls.push("resume")
        synth.paused = false
      },
      cancel: () => calls.push("cancel"),
    }
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true })
    scope.SpeechSynthesisUtterance = class {
      lang = ""
      onend = null
      onerror = null
      constructor(public text: string) {}
    }
    install()
    const toggle = () => window.dispatchEvent(new CustomEvent("tts-toggle", { detail: { text: "**Salut** `bun`" } }))
    const realNow = Date.now
    let now = 1_000
    Date.now = () => now
    cleanups.push(() => (Date.now = realNow))

    toggle()
    now += 1_000
    toggle()
    now += 1_000
    toggle()
    now += 100
    toggle()
    expect(calls).toEqual(["cancel", "speak:Salut bun", "pause", "resume", "cancel"])
  })

  test("autoplay follows its setting and cannot interrupt manual playback", () => {
    const calls: string[] = []
    const utterances: Array<{ onend: (() => void) | null }> = []
    const synth = {
      speaking: false,
      paused: false,
      speak: (utterance: { text: string }) => {
        calls.push(`speak:${utterance.text}`)
        synth.speaking = true
      },
      pause: () => { calls.push("pause"); synth.paused = true },
      resume: () => { calls.push("resume"); synth.paused = false },
      cancel: () => calls.push("cancel"),
    }
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true })
    scope.SpeechSynthesisUtterance = class {
      lang = ""
      onend: (() => void) | null = null
      onerror = null
      constructor(public text: string) { utterances.push(this) }
    }
    const previous = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY)
    localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, serializeAudioSettings(DEFAULT_AUDIO_SETTINGS))
    cleanups.push(() => previous === null
      ? localStorage.removeItem(AUDIO_SETTINGS_STORAGE_KEY)
      : localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, previous))
    install()

    window.dispatchEvent(new CustomEvent("tts-autoplay", { detail: { text: "disabled" } }))
    localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, serializeAudioSettings({ ...DEFAULT_AUDIO_SETTINGS, ttsAutoPlay: true }))
    window.dispatchEvent(new CustomEvent("tts-toggle", { detail: { text: "manual" } }))
    window.dispatchEvent(new CustomEvent("tts-autoplay", { detail: { text: "automatic" } }))
    utterances[0]?.onend?.()
    window.dispatchEvent(new CustomEvent("tts-autoplay", { detail: { text: "automatic" } }))

    expect(calls).toEqual(["cancel", "speak:manual", "cancel", "speak:automatic"])
  })
})
