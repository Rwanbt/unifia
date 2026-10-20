/* SPDX-License-Identifier: MIT */

import { AudioPlaybackCoordinator, type AudioPlaybackLease, type AudioPlaybackPriority } from "../voice/audio-playback-coordinator"
import { installAudioCaptureCoordinator, requestAudioCapture, type AudioCaptureLease } from "../voice/audio-capture-coordinator"
import { loadAudioSettings } from "../voice/audio-settings"
import type { NativeDictation } from "./native-dictation"

// Voice input and read-aloud for the web runtime, through the browser's own
// speech APIs. The desktop and mobile shells answer the same window events
// with their local engines (packages/desktop/src/hooks/use-speech.ts); this
// module is installed only by the web entry.
//
// Events answered: "stt-start", "stt-stop", "tts-toggle" ({ text }).
// Events emitted: "speech-ended" ({ kind: "stt" | "tts", reason }), so the
// composer can leave its recording state and explain a failure.

export type SpeechEndReason = "done" | "unsupported" | "denied" | "error"
export type SpeechEndDetail = { kind: "stt" | "tts"; reason: SpeechEndReason }

type RecognitionResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { resultIndex: number; results: RecognitionResultList }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionConstructor = new () => Recognition

const DOUBLE_CLICK_MS = 400

// Markdown the voice should not spell out: code blocks, inline code marks,
// emphasis, headings, list bullets and link targets.
export function speakableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function recognitionConstructor(win: Window): RecognitionConstructor | undefined {
  const scope = win as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

function insertInComposer(doc: Document, text: string) {
  const editor = doc.querySelector<HTMLElement>("[data-component='prompt-input'][contenteditable='true']")
  if (!editor) return
  if (doc.activeElement === editor) {
    doc.execCommand("insertText", false, text)
    return
  }
  // Focusing the composer opens the Android soft keyboard, whose dictation service sends audio to Google.
  const separator = editor.textContent?.trim() ? " " : ""
  editor.append(doc.createTextNode(separator + text))
  editor.dispatchEvent(new Event("input", { bubbles: true }))
}

export type WebSpeechOptions = {
  /** Mobile shell: dictation runs on the local Parakeet engine instead of browser recognition. */
  nativeDictation?: NativeDictation
}

type NativeDictationSession = {
  lease: AudioCaptureLease
  starting: Promise<boolean>
  stopping: boolean
}

export function installWebSpeech(win: Window = window, options: WebSpeechOptions = {}) {
  const cleanupCaptureCoordinator = installAudioCaptureCoordinator(win)
  const emit = (detail: SpeechEndDetail) => win.dispatchEvent(new CustomEvent("speech-ended", { detail }))
  const lang = () => win.document.documentElement.lang || win.navigator.language || "en-US"

  let recognition: Recognition | undefined
  let captureLease: AudioCaptureLease | undefined
  let transcript = ""
  let failure: SpeechEndReason | undefined
  const playbackCoordinator = new AudioPlaybackCoordinator()
  let activePlaybackLease: AudioPlaybackLease | undefined

  let nativeSession: NativeDictationSession | undefined

  const requestNativeLease = (native: NativeDictation) => {
    try {
      return requestAudioCapture(win, "dictation", () => void stopNativeDictation(native))
    } catch (error) {
      console.warn("[STT] Microphone ownership request failed:", error)
      return undefined
    }
  }

  // A stop that arrives while the native start is still in flight waits for it, so the
  // engine is never finished before it has started.
  const stopNativeDictation = async (native: NativeDictation) => {
    const session = nativeSession
    if (!session || session.stopping) return
    session.stopping = true
    try {
      if (!(await session.starting)) return
      const text = (await native.finish()).trim()
      if (text) insertInComposer(win.document, text)
      emit({ kind: "stt", reason: "done" })
    } catch (error) {
      console.warn("[STT] Native dictation failed:", error)
      emit({ kind: "stt", reason: "error" })
    } finally {
      session.lease.release()
      if (nativeSession === session) nativeSession = undefined
    }
  }

  const startNativeDictation = (native: NativeDictation) => {
    if (nativeSession) return
    const lease = requestNativeLease(native)
    if (!lease) return emit({ kind: "stt", reason: "error" })
    const starting = native.start().then(
      () => true,
      (error: unknown) => {
        console.warn("[STT] Native dictation failed to start:", error)
        if (nativeSession?.lease === lease) nativeSession = undefined
        lease.release()
        emit({ kind: "stt", reason: "error" })
        return false
      },
    )
    nativeSession = { lease, starting, stopping: false }
  }

  const startDictation = () => {
    if (options.nativeDictation) return void startNativeDictation(options.nativeDictation)
    if (recognition) return
    const Constructor = recognitionConstructor(win)
    if (!Constructor) return emit({ kind: "stt", reason: "unsupported" })
    let lease: AudioCaptureLease | undefined
    try {
      lease = requestAudioCapture(win, "dictation", () => recognition?.stop())
    } catch (error) {
      console.warn("[STT] Microphone ownership request failed:", error)
      emit({ kind: "stt", reason: "error" })
      return
    }
    if (!lease) {
      emit({ kind: "stt", reason: "error" })
      return
    }
    transcript = ""
    failure = undefined
    const current = new Constructor()
    current.lang = lang()
    current.continuous = true
    current.interimResults = false
    current.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        if (result.isFinal) transcript += result[0].transcript
      }
    }
    current.onerror = (event) => {
      failure = event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied" : "error"
    }
    // Fires on stop(), on silence and after an error: the one place to finish.
    current.onend = () => {
      if (recognition !== current) return
      recognition = undefined
      if (captureLease?.id === lease?.id) captureLease = undefined
      lease?.release()
      if (transcript.trim()) insertInComposer(win.document, transcript.trim())
      emit({ kind: "stt", reason: failure ?? "done" })
    }
    recognition = current
    captureLease = lease
    try {
      current.start()
    } catch (error) {
      recognition = undefined
      captureLease = undefined
      lease.release()
      const name = (error as { name?: string } | null)?.name
      emit({ kind: "stt", reason: name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "error" })
    }
  }

  const stopDictation = () => {
    if (options.nativeDictation) return void stopNativeDictation(options.nativeDictation)
    recognition?.stop()
  }

  // The one-minute cap ends the dictation the same way the user's stop does, so the text is kept.
  if (options.nativeDictation) {
    const native = options.nativeDictation
    native.onFull(() => void stopNativeDictation(native))
  }

  let lastToggle = 0
  const toggleReadAloud = (event: Event, priority: AudioPlaybackPriority) => {
    const synth = win.speechSynthesis
    if (!synth) return emit({ kind: "tts", reason: "unsupported" })
    if (priority === "autoplay" && !loadAudioSettings({ getItem: (key) => win.localStorage.getItem(key) }).ttsAutoPlay) return
    const now = Date.now()
    const detail = (event as CustomEvent<{ text?: string }>).detail
    const doubleClick = priority === "manual" && now - lastToggle < DOUBLE_CLICK_MS
    if (priority === "manual") lastToggle = now
    if (doubleClick) {
      playbackCoordinator.stop()
      activePlaybackLease = undefined
      return
    }
    if (priority === "manual" && activePlaybackLease?.priority === "manual" && synth.speaking && !synth.paused) return synth.pause()
    if (priority === "manual" && activePlaybackLease?.priority === "manual" && synth.paused) return synth.resume()

    const text = speakableText(String(detail?.text ?? ""))
    if (!text) return
    const language = lang()
    const voice = synth.getVoices()
      .filter((candidate) => candidate.localService && candidate.lang.toLowerCase().startsWith(language.toLowerCase()))
      .sort((left, right) => Number(right.default) - Number(left.default))[0]
    if (!voice) return emit({ kind: "tts", reason: "unsupported" })
    const hadTrackedPlayback = activePlaybackLease !== undefined
    const lease = playbackCoordinator.acquire(priority, () => synth.cancel())
    if (!lease) return
    activePlaybackLease = lease
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voice.lang
    utterance.voice = voice
    const release = () => {
      playbackCoordinator.release(lease)
      if (activePlaybackLease?.id === lease.id) activePlaybackLease = undefined
    }
    utterance.onend = () => {
      release()
      emit({ kind: "tts", reason: "done" })
    }
    utterance.onerror = (error) => {
      release()
      if (error.error !== "canceled" && error.error !== "interrupted") emit({ kind: "tts", reason: "error" })
    }
    if (!hadTrackedPlayback) synth.cancel()
    synth.speak(utterance)
  }

  const toggleManualReadAloud = (event: Event) => toggleReadAloud(event, "manual")
  const autoplayReadAloud = (event: Event) => toggleReadAloud(event, "autoplay")
  let livePlaybackLease: AudioPlaybackLease | undefined
  let livePlaybackId: string | undefined
  const livePlaybackStarted = (event: Event) => {
    const detail = (event as CustomEvent<{ id?: string; stop?: () => void }>).detail
    if (!detail?.id || typeof detail.stop !== "function") return
    const { id, stop } = detail
    const lease = playbackCoordinator.acquire("live", stop)
    if (lease) {
      livePlaybackLease = lease
      livePlaybackId = id
    }
  }
  const livePlaybackEnded = (event?: Event) => {
    const id = (event as CustomEvent<{ id?: string }> | undefined)?.detail?.id
    if (event && (!id || id !== livePlaybackId)) return
    if (livePlaybackLease) playbackCoordinator.release(livePlaybackLease)
    livePlaybackLease = undefined
    livePlaybackId = undefined
  }

  win.addEventListener("stt-start", startDictation)
  win.addEventListener("stt-stop", stopDictation)
  win.addEventListener("tts-toggle", toggleManualReadAloud)
  win.addEventListener("tts-autoplay", autoplayReadAloud)
  win.addEventListener("tts-live-start", livePlaybackStarted)
  win.addEventListener("tts-live-ended", livePlaybackEnded)
  return () => {
    win.removeEventListener("stt-start", startDictation)
    win.removeEventListener("stt-stop", stopDictation)
    win.removeEventListener("tts-toggle", toggleManualReadAloud)
    win.removeEventListener("tts-autoplay", autoplayReadAloud)
    win.removeEventListener("tts-live-start", livePlaybackStarted)
    win.removeEventListener("tts-live-ended", livePlaybackEnded)
    playbackCoordinator.stop()
    recognition?.stop()
    captureLease?.release()
    captureLease = undefined
    cleanupCaptureCoordinator()
    win.speechSynthesis?.cancel()
  }
}
