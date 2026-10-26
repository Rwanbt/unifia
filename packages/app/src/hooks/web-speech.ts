/* SPDX-License-Identifier: MIT */

import { AudioPlaybackCoordinator, type AudioPlaybackLease, type AudioPlaybackPriority } from "../voice/audio-playback-coordinator"
import { installAudioCaptureCoordinator, requestAudioCapture, type AudioCaptureLease } from "../voice/audio-capture-coordinator"
import { loadAudioSettings } from "../voice/audio-settings"
import type { NativeDictation } from "./native-dictation"
import { nativeVoiceCode } from "../voice/native-voice-error"
import { DictationController } from "../voice/dictation-controller"
import { createBrowserSpeechEngine, type RecognitionLike } from "../voice/browser-speech-engine"
import { withCaptureLease } from "../voice/leased-engine"
import { createNativeDictationEngine } from "../voice/native-dictation-engine"

// Voice input and read-aloud for the web runtime, through the browser's own
// speech APIs. The desktop and mobile shells answer the same window events
// with their local engines (packages/desktop/src/hooks/use-speech.ts); this
// module is installed only by the web entry.
//
// Events answered: "stt-start", "stt-stop", "tts-toggle" ({ text }).
// Events emitted: "speech-ended" ({ kind: "stt" | "tts", reason }), so the
// composer can leave its recording state and explain a failure.

import {
  emitSpeech,
  onSpeech,
  speechEvents,
  type SpeechEndDetail,
  type SpeechEndReason,
} from "../voice/speech-events"

export type { SpeechEndDetail, SpeechEndReason } from "../voice/speech-events"

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

/**
 * Inserts before the trailing `<br>` the composer keeps at the end of its
 * content. Appending after that break yields an empty line above the text.
 */
function append(editor: HTMLElement, node: Node) {
  let last = editor.lastChild
  if (last?.nodeType === Node.TEXT_NODE && (last.textContent ?? "") === "\u200B") last = last.previousSibling
  if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") editor.insertBefore(node, last)
  else editor.append(node)
}

export function insertInComposer(doc: Document, text: string) {
  const editor = doc.querySelector<HTMLElement>("[data-component='prompt-input'][contenteditable='true']")
  if (!editor) return
  clearPreview(doc)
  if (doc.activeElement === editor) {
    doc.execCommand("insertText", false, text)
    return
  }
  // Focusing the composer opens the Android soft keyboard, whose dictation service sends audio to Google.
  const content = (editor.textContent ?? "").replaceAll("\u200B", "").trimEnd()
  append(editor, doc.createTextNode(content ? ` ${text}` : text))
  editor.dispatchEvent(new Event("input", { bubbles: true }))
}

function editorOf(doc: Document) {
  return doc.querySelector<HTMLElement>("[data-component='prompt-input'][contenteditable='true']")
}

/** Removes the provisional transcript, if one is shown. */
function clearPreview(doc: Document) {
  editorOf(doc)?.querySelectorAll("[data-stt-preview]").forEach((node) => node.remove())
}

// Same rule as the final insertion: never focus the composer, or Android opens
// the soft keyboard and its cloud-backed dictation.
function previewInComposer(doc: Document, text: string) {
  const editor = editorOf(doc)
  if (!editor) return
  const existing = editor.querySelector<HTMLElement>("[data-stt-preview]")
  if (existing) {
    existing.textContent = text
    return
  }
  const span = doc.createElement("span")
  span.dataset.sttPreview = "true"
  span.setAttribute("contenteditable", "false")
  span.style.opacity = "0.55"
  // A margin instead of a text node: the preview leaves nothing behind when removed.
  if ((editor.textContent ?? "").replaceAll("\u200B", "").trim()) span.style.marginLeft = "0.25em"
  append(editor, span)
  span.textContent = text
}

export type WebSpeechOptions = {
  /** Mobile shell: dictation runs on the local Parakeet engine instead of browser recognition. */
  nativeDictation?: NativeDictation
}

export function installWebSpeech(win: Window = window, options: WebSpeechOptions = {}) {
  const cleanupCaptureCoordinator = installAudioCaptureCoordinator(win)
  const emit = (detail: SpeechEndDetail) => emitSpeech(win, speechEvents.speechEnded, detail)
  const lang = () => win.document.documentElement.lang || win.navigator.language || "en-US"

  let browserController: DictationController | undefined
  let browserFailed = false
  const playbackCoordinator = new AudioPlaybackCoordinator()
  let activePlaybackLease: AudioPlaybackLease | undefined

  let nativeController: DictationController | undefined
  let nativeFailed = false
  let nativeStarting: Promise<void> | undefined

  const browserReason = (error: unknown): SpeechEndReason => {
    const name = (error as { name?: string } | null)?.name
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied"
    if (name === "NotSupportedError") return "unsupported"
    return "error"
  }

  if (!options.nativeDictation) {
    const engine = withCaptureLease(
      createBrowserSpeechEngine({
        createRecognition: () => {
          const Constructor = recognitionConstructor(win)
          return Constructor ? (new Constructor() as unknown as RecognitionLike) : undefined
        },
        language: lang,
      }),
      { acquire: () => requestAudioCapture(win, "dictation", () => void browserController?.cancel()) },
    )
    browserController = new DictationController({
      engine,
      onText: (text) => insertInComposer(win.document, text),
      onError: (error) => {
        browserFailed = true
        emit({ kind: "stt", reason: browserReason(error), code: nativeVoiceCode(error) })
      },
    })
  }

  if (options.nativeDictation) {
    const native = options.nativeDictation
    const engine = withCaptureLease(createNativeDictationEngine(native), {
      acquire: () => requestAudioCapture(win, "dictation", () => void nativeController?.cancel()),
    })
    nativeController = new DictationController({
      engine,
      onText: (text) => insertInComposer(win.document, text),
      onPartial: (text) => previewInComposer(win.document, text),
      onLevel: (level) => emitSpeech(win, speechEvents.sttLevel, { level }),
      onError: (error) => {
        nativeFailed = true
        emit({ kind: "stt", reason: browserReason(error), code: nativeVoiceCode(error) })
      },
    })
    // The one-minute cap ends the dictation the same way the user's stop does.
    native.onFull(() => void stopDictation())
  }

  const startDictation = () => {
    if (options.nativeDictation) {
      nativeFailed = false
      nativeStarting = nativeController?.start()
      return
    }
    browserFailed = false
    void browserController?.start()
  }

  const stopDictation = () => {
    if (options.nativeDictation) {
      void (async () => {
        await nativeStarting
        if (nativeController?.state !== "recording") return
        await nativeController.finish()
        if (!nativeFailed) emit({ kind: "stt", reason: "done" })
      })()
      return
    }
    if (browserController?.state !== "recording") return
    void (async () => {
      await browserController.finish()
      if (!browserFailed) emit({ kind: "stt", reason: "done" })
    })()
  }

  let lastToggle = 0
  const toggleReadAloud = (detail: { text?: string }, priority: AudioPlaybackPriority) => {
    const synth = win.speechSynthesis
    if (!synth) return emit({ kind: "tts", reason: "unsupported" })
    if (priority === "autoplay" && !loadAudioSettings({ getItem: (key) => win.localStorage.getItem(key) }).ttsAutoPlay) return
    const now = Date.now()
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

  const toggleManualReadAloud = (detail: { text?: string }) => toggleReadAloud(detail, "manual")
  const autoplayReadAloud = (detail: { text?: string }) => toggleReadAloud(detail, "autoplay")
  let livePlaybackLease: AudioPlaybackLease | undefined
  let livePlaybackId: string | undefined
  const livePlaybackStarted = (detail: { id?: string; stop?: () => void }) => {
    if (!detail?.id || typeof detail.stop !== "function") return
    const { id, stop } = detail
    const lease = playbackCoordinator.acquire("live", stop)
    if (lease) {
      livePlaybackLease = lease
      livePlaybackId = id
    }
  }
  const livePlaybackEnded = (detail?: { id?: string }) => {
    const id = detail?.id
    if (detail && (!id || id !== livePlaybackId)) return
    if (livePlaybackLease) playbackCoordinator.release(livePlaybackLease)
    livePlaybackLease = undefined
    livePlaybackId = undefined
  }

  const unsubscribes = [
    onSpeech(win, speechEvents.sttStart, startDictation),
    onSpeech(win, speechEvents.sttStop, stopDictation),
    onSpeech(win, speechEvents.ttsToggle, toggleManualReadAloud),
    onSpeech(win, speechEvents.ttsAutoplay, autoplayReadAloud),
    onSpeech(win, speechEvents.ttsLiveStart, livePlaybackStarted),
    onSpeech(win, speechEvents.ttsLiveEnded, livePlaybackEnded),
  ]
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe()
    playbackCoordinator.stop()
    void browserController?.cancel()
    browserController?.dispose()
    browserController = undefined
    void nativeController?.cancel()
    nativeController?.dispose()
    nativeController = undefined
    cleanupCaptureCoordinator()
    win.speechSynthesis?.cancel()
  }
}
