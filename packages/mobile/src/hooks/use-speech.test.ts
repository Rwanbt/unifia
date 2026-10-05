/* SPDX-License-Identifier: MIT */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { TtsAudioChunk, TtsProviderError } from "@unifia/contracts/tts-router"
import type { TtsRequest } from "@unifia/contracts/speech"
import { AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS } from "../../../app/src/voice/audio-settings"

// Manual read-aloud: a `tts-toggle` event must reach the Android router with the
// language, voice and rate the user saved, and every way out (done, stopped,
// failed) must announce `speech-ended`.

type Event_ = TtsAudioChunk | TtsProviderError
let synthesizeScript: (request: TtsRequest, signal: AbortSignal) => AsyncIterable<Event_>
const requests: TtsRequest[] = []
const toasts: Array<{ title: string; description: string }> = []

class FakePlayer {
  enqueued: TtsAudioChunk[] = []
  paused = false
  stopped = false
  drainGate: Promise<void> = Promise.resolve()
  enqueue(chunk: TtsAudioChunk) { this.enqueued.push(chunk) }
  drain() { return this.drainGate }
  async pause() { this.paused = true }
  async resume() { this.paused = false }
  stop() { this.stopped = true }
}
let players: FakePlayer[] = []
let nextDrainGate: Promise<void> | undefined

let initSpeechListeners: typeof import("./use-speech").initSpeechListeners
let cleanupSpeechListeners: typeof import("./use-speech").cleanupSpeechListeners

const chunk = (sequence: number, final = false): TtsAudioChunk => ({ samples: new Int16Array([sequence]), sampleRateHz: 24_000, generatedAt: sequence, sequence, final })
const providerError = (recoverable: boolean): TtsProviderError => ({ code: "pocket.unavailable", detail: "no pack", recoverable, capturedAt: 0 })

beforeAll(async () => {
  mock.module("../../../app/src/hooks/speech-tauri-adapter", () => ({
    invokeTauri: async () => false,
    convertFileSrc: (path: string) => path,
  }))
  mock.module("../../../app/src/voice/android-tts-router", () => ({
    createAndroidTtsRouter: () => ({
      synthesize(request: TtsRequest, signal: AbortSignal) {
        requests.push(request)
        return synthesizeScript(request, signal)
      },
    }),
  }))
  mock.module("../../../app/src/voice/webaudio-pcm-player", () => ({
    createWebAudioPcmPlayer: () => {
      const player = new FakePlayer()
      if (nextDrainGate) player.drainGate = nextDrainGate
      players.push(player)
      return player
    },
  }))
  mock.module("@unifia/ui/toast", () => ({ showToast: (toast: { title: string; description: string }) => { toasts.push(toast) } }))
  const mod = await import("./use-speech")
  initSpeechListeners = mod.initSpeechListeners
  cleanupSpeechListeners = mod.cleanupSpeechListeners
})

let ended: string[]
const onEnded = (event: Event) => { ended.push((event as CustomEvent<{ reason: string }>).detail.reason) }

beforeEach(() => {
  requests.length = 0
  toasts.length = 0
  players = []
  nextDrainGate = undefined
  ended = []
  synthesizeScript = async function* () { yield chunk(0); yield chunk(1, true) }
  localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, ttsLanguage: "fr", voiceByLanguage: { fr: "voice-m.wav" }, ttsSpeedByLanguage: { fr: 1.25 } }))
  window.addEventListener("speech-ended", onEnded)
  initSpeechListeners()
})

afterEach(() => {
  cleanupSpeechListeners()
  window.removeEventListener("speech-ended", onEnded)
  localStorage.removeItem(AUDIO_SETTINGS_STORAGE_KEY)
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function toggle(text: string) {
  window.dispatchEvent(new CustomEvent("tts-toggle", { detail: { text } }))
  await flush()
  await flush()
}

describe("mobile manual read-aloud", () => {
  test("the request carries the saved speech language, voice and per-language rate", async () => {
    await toggle("Bonjour")

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ text: "Bonjour", language: "fr", voice: "voice-m.wav", speed: 1.25 })
  })

  test("every chunk reaches the player and playback ends once, as done", async () => {
    await toggle("Bonjour")

    expect(players[0]?.enqueued.map((entry) => entry.sequence)).toEqual([0, 1])
    expect(ended).toEqual(["done"])
  })

  test("markdown is stripped before synthesis and empty text never synthesizes", async () => {
    await toggle("```\ncode only\n```")
    expect(requests).toHaveLength(0)

    await toggle("**Bonjour** `monde`")
    expect(requests[0]?.text).not.toContain("`")
  })

  test("a recoverable provider error is skipped and playback continues", async () => {
    synthesizeScript = async function* () { yield providerError(true); yield chunk(0, true) }

    await toggle("Bonjour")

    expect(players[0]?.enqueued).toHaveLength(1)
    expect(toasts).toHaveLength(0)
    expect(ended).toEqual(["done"])
  })

  test("a fatal provider error names the requested language and ends as error", async () => {
    synthesizeScript = async function* () { yield providerError(false) }

    await toggle("Bonjour")

    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.description).toContain('"fr"')
    expect(players[0]?.stopped).toBe(true)
    expect(ended.at(-1)).toBe("error")
  })

  // KNOWN DEFECT: the failure path calls stopManualPlayback (which announces
  // "done") and then announces "error", so a listener sees a clean end before
  // the failure. Flip to `test` once the error path stops announcing twice.
  test.failing("a fatal provider error announces speech-ended exactly once", async () => {
    synthesizeScript = async function* () { yield providerError(false) }

    await toggle("Bonjour")

    expect(ended).toEqual(["error"])
  })

  test("a toggle while synthesis is pending stops playback and aborts the router", async () => {
    let seenSignal: AbortSignal | undefined
    let release: () => void = () => {}
    synthesizeScript = async function* (_request, signal) {
      seenSignal = signal
      await new Promise<void>((resolve) => { release = resolve })
      yield chunk(0, true)
    }

    window.dispatchEvent(new CustomEvent("tts-toggle", { detail: { text: "Bonjour" } }))
    await flush()
    await toggle("Bonjour")

    expect(seenSignal?.aborted).toBe(true)
    expect(ended).toEqual(["done"])
    release()
    await flush()
    // The late chunk belongs to a stopped playback and must not reach the player.
    expect(players[0]?.enqueued).toHaveLength(0)
  })

  test("a later single tap while playing pauses, and the next one resumes", async () => {
    const realNow = Date.now
    let now = 1_000_000
    Date.now = () => now
    let finishDrain: () => void = () => {}
    nextDrainGate = new Promise<void>((resolve) => { finishDrain = resolve })
    try {
      await toggle("Bonjour")
      expect(players[0]?.enqueued).toHaveLength(2)

      now += 1_000
      await toggle("Bonjour")
      expect(players[0]?.paused).toBe(true)

      now += 1_000
      await toggle("Bonjour")
      expect(players[0]?.paused).toBe(false)
      expect(requests).toHaveLength(1)
    } finally {
      Date.now = realNow
      finishDrain()
      await flush()
    }
  })

  test("a double tap while playing stops playback", async () => {
    const realNow = Date.now
    let now = 2_000_000
    Date.now = () => now
    nextDrainGate = new Promise<void>(() => {})
    try {
      await toggle("Bonjour")
      now += 100
      await toggle("Bonjour")

      expect(players[0]?.stopped).toBe(true)
      expect(ended).toEqual(["done"])
    } finally {
      Date.now = realNow
    }
  })
})
