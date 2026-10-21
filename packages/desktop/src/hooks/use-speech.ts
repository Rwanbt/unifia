/**
 * Speech hooks for desktop.
 * STT: record mic → WAV → Parakeet ONNX → text in editor
 * TTS: managed Pocket worker → WAV file → audio playback
 */

import { invokeTauri, convertFileSrc } from "../../../app/src/hooks/speech-tauri-adapter"
import { blobToWavBase64 } from "../../../app/src/voice/wav"
import { splitIntoChunks } from "../../../app/src/voice/tts-chunking"
import { DictationController } from "../../../app/src/voice/dictation-controller"
import { createMediaRecorderEngine } from "../../../app/src/voice/media-recorder-engine"
import { acquireCurrentAudioStream, cancelAudioCaptureRequest, installAudioCaptureCoordinator, requestAudioCapture, type AudioCaptureLease } from "../../../app/src/voice/audio-capture-coordinator"
import { AudioPlaybackCoordinator, type AudioPlaybackLease, type AudioPlaybackPriority } from "../../../app/src/voice/audio-playback-coordinator"
import { loadAudioSettings } from "../../../app/src/voice/audio-settings"
import { resolveSpeechLanguage, type SpeechLanguage } from "../../../contracts/src/speech"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { showToast, toaster } from "@unifia/ui/toast"

let dictation: DictationController | undefined
let captureLease: AudioCaptureLease | undefined
let captureStream: MediaStream | undefined
let captureCoordinatorCleanup: (() => void) | undefined
let runtimeProgressUnlisten: UnlistenFn | undefined
let runtimeProgressToastId: string | number | undefined
let playbackCoordinator: AudioPlaybackCoordinator | undefined
let activePlaybackLease: AudioPlaybackLease | undefined
let livePlaybackLease: AudioPlaybackLease | undefined
let livePlaybackId: string | undefined
let playbackGeneration = 0
let activePreviewId: string | undefined

const ttsToggleListener = (event: Event) => { void handleTtsToggle(event as CustomEvent, "manual") }
const ttsAutoplayListener = (event: Event) => { void handleTtsToggle(event as CustomEvent, "autoplay") }
const livePlaybackStarted = (event: Event) => {
  const detail = (event as CustomEvent<{ id?: string; stop?: () => void }>).detail
  if (!detail?.id || typeof detail.stop !== "function") return
  const { id, stop } = detail
  livePlaybackLease = playbackCoordinator?.acquire("live", () => stop?.())
  if (livePlaybackLease) livePlaybackId = id
}
const livePlaybackEnded = (event?: Event) => {
  const id = (event as CustomEvent<{ id?: string }> | undefined)?.detail?.id
  if (event && (!id || id !== livePlaybackId)) return
  if (livePlaybackLease) playbackCoordinator?.release(livePlaybackLease)
  livePlaybackLease = undefined
  livePlaybackId = undefined
}

export function initSpeechListeners() {
  captureCoordinatorCleanup ??= installAudioCaptureCoordinator(window)
  playbackCoordinator ??= new AudioPlaybackCoordinator()
  window.addEventListener("stt-start", handleSttStart)
  window.addEventListener("stt-stop", handleSttStop)
  window.addEventListener("tts-toggle", ttsToggleListener)
  window.addEventListener("tts-autoplay", ttsAutoplayListener)
  window.addEventListener("tts-live-start", livePlaybackStarted)
  window.addEventListener("tts-live-ended", livePlaybackEnded)
  void listen<{ phase: string; message: string }>("voice-runtime-progress", (event) => {
    if (event.payload.phase === "ready" && runtimeProgressToastId === undefined) return
    if (typeof runtimeProgressToastId === "number") toaster.dismiss(runtimeProgressToastId)
    const { phase, message } = event.payload
    const toastId = showToast({
      title: "Speech",
      description: message,
      variant: phase === "error" ? "error" : phase === "ready" ? "success" : "loading",
      persistent: phase !== "ready",
      duration: phase === "ready" ? 3000 : undefined,
    })
    runtimeProgressToastId = typeof toastId === "number" ? toastId : undefined
    if (phase === "ready") runtimeProgressToastId = undefined
  }).then((unlisten) => {
    runtimeProgressUnlisten = unlisten
  }).catch((error) => {
    console.warn("[TTS] Runtime progress listener could not start:", error)
  })
  console.log("[Speech] All listeners initialized (stt-start, stt-stop, tts-toggle, tts-autoplay)")
  dictation = createDictation()
  // Pre-load Parakeet model so it's warm when user presses mic
  preloadModels()
}

async function preloadModels() {
  try {
    const available = await invokeTauri("stt_available")
    if (available) {
      console.log("[STT] Pre-loading Parakeet model...")
      await invokeTauri("stt_load_model")
      console.log("[STT] Model loaded")
    }
  } catch (e) {
    console.warn("[STT] Pre-load failed:", e)
  }
  // Pre-start the only bundled TTS engine.
  try {
    console.log("[TTS] Starting managed Pocket worker...")
    await invokeTauri("tts_start")
    console.log("[TTS] Pocket worker ready")
  } catch (e) {
    console.warn("[TTS] Pre-start failed:", e)
  }
}

export function cleanupSpeechListeners() {
  window.removeEventListener("stt-start", handleSttStart)
  window.removeEventListener("stt-stop", handleSttStop)
  window.removeEventListener("tts-toggle", ttsToggleListener)
  window.removeEventListener("tts-autoplay", ttsAutoplayListener)
  window.removeEventListener("tts-live-start", livePlaybackStarted)
  window.removeEventListener("tts-live-ended", livePlaybackEnded)
  stopPlayback(true)
  livePlaybackEnded()
  playbackCoordinator = undefined
  void dictation?.cancel()
  dictation?.dispose()
  dictation = undefined
  captureCoordinatorCleanup?.()
  captureCoordinatorCleanup = undefined
  runtimeProgressUnlisten?.()
  runtimeProgressUnlisten = undefined
  if (typeof runtimeProgressToastId === "number") toaster.dismiss(runtimeProgressToastId)
  runtimeProgressToastId = undefined
  // Note: can't remove exact reference since we wrapped it, but cleanup on app close is fine
}

// ─── STT ───────────────────────────────────────────────────────────────

async function handleSttStart() {
  if (!dictation) return
  await dictation.start()
}

async function handleSttStop() {
  if (!dictation) return
  await dictation.finish()
}

function stopDictationCapture() {
  // An explicit stop is already transcribing: Live taking the microphone must
  // not discard it — the dictated text still lands in the prompt.
  if (dictation?.state === "finishing") return
  void dictation?.cancel()
}

function errorReason(error: unknown): "denied" | "error" {
  const name = (error as { name?: string } | null)?.name
  return name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "error"
}

function createDictation() {
  return new DictationController({
    engine: createMediaRecorderEngine({
      acquire: async () => {
        const lease = requestAudioCapture(window, "dictation", stopDictationCapture)
        if (!lease) return undefined
        captureLease = lease
        const stream = await acquireCurrentAudioStream(lease, () =>
          navigator.mediaDevices.getUserMedia({ audio: { sampleRate: { ideal: 16000 }, channelCount: 1 } }))
        if (!stream) return undefined
        captureStream = stream
        return {
          stream,
          release: () => {
            captureStream = undefined
            captureLease = undefined
            stream.getTracks().forEach((track) => track.stop())
            lease.release()
          },
        }
      },
      cancelCapture: () => cancelAudioCaptureRequest(captureLease, captureStream),
      invoke: invokeTauri,
      convert: blobToWavBase64,
    }),
    onText: (text) => insertTextInEditor(text),
    onError: (error) => {
      console.error("[STT] Failed:", error)
      window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "stt", reason: errorReason(error) } }))
    },
  })
}

// ─── TTS (Pocket TTS) — Chunked playback ────────────────────────────

type TtsState = "idle" | "loading" | "playing" | "paused"
let ttsState: TtsState = "idle"
let currentAudio: HTMLAudioElement | null = null
let lastDblClick = 0
let chunkQueue: string[] = []       // sentences waiting to be synthesized
let prefetchedPath: string | null = null  // next chunk already synthesized
let prefetchPromise: Promise<string> | null = null
let ttsAborted = false              // signal to stop chunked playback
let playedPaths: string[] = []      // paths to clean up after playback

function getAudioSettings() {
  return loadAudioSettings()
}

function synthesizeChunk(text: string, voice: string, language: SpeechLanguage, provider: string): Promise<string> {
  // Pocket TTS is ~27ms/char on CPU. Keep chunks small (1 sentence) to
  // minimize time-to-first-audio; the full request is buffered server-side.
  return invokeTauri("tts_speak", { text, voice, language, provider })
}

function stopPlayback(cancelSynthesis = false) {
  playbackGeneration++
  ttsAborted = true
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  chunkQueue = []
  prefetchedPath = null
  prefetchPromise = null
  ttsState = "idle"
  const lease = activePlaybackLease
  activePlaybackLease = undefined
  if (lease) playbackCoordinator?.release(lease)
  if (cancelSynthesis) {
    void invokeTauri("tts_cancel").catch((error) => console.warn("[TTS] Cancellation failed:", error))
  }
  if (activePreviewId) {
    window.dispatchEvent(new CustomEvent("tts-preview-ended", { detail: { id: activePreviewId } }))
    activePreviewId = undefined
  }
  // Cleanup temp files in background
  if (playedPaths.length > 0) {
    invokeTauri("tts_cleanup_chunks").catch(() => {})
    playedPaths = []
  }
}

async function playNextChunk(voice: string, language: SpeechLanguage, speed: number, provider: string, generation: number) {
  if (ttsAborted || generation !== playbackGeneration) return

  // Get the next WAV path — either pre-fetched or synthesize now
  let wavPath: string | null = null
  if (prefetchedPath) {
    wavPath = prefetchedPath
    prefetchedPath = null
  } else if (prefetchPromise) {
    try { wavPath = await prefetchPromise } catch { /* handled below */ }
    prefetchPromise = null
  }

  if (!wavPath || ttsAborted || generation !== playbackGeneration) {
    if (generation === playbackGeneration) stopPlayback(true)
    return
  }

  playedPaths.push(wavPath)

  // Start pre-fetching the next chunk while this one plays.
  // Guard: skip if a prefetch is already in flight or ready (e.g. C1 was
  // pre-launched in parallel with C0 from handleTtsToggle).
  if (chunkQueue.length > 0 && !prefetchPromise && !prefetchedPath) {
    const nextText = chunkQueue.shift()!
    prefetchPromise = synthesizeChunk(nextText, voice, language, provider)
    prefetchPromise.then(path => {
      if (generation !== playbackGeneration) return
      prefetchedPath = path
      prefetchPromise = null
    }).catch(() => {
      if (generation !== playbackGeneration) return
      prefetchedPath = null
      prefetchPromise = null
    })
  }

  // Play current chunk
  const audioUrl = convertFileSrc(wavPath)
  const audio = new Audio(audioUrl)
  audio.playbackRate = speed
  currentAudio = audio

  audio.onended = () => {
    currentAudio = null
    if (ttsAborted || generation !== playbackGeneration) return
    if (chunkQueue.length > 0 || prefetchedPath || prefetchPromise) {
      void playNextChunk(voice, language, speed, provider, generation)
    } else {
      stopPlayback()
    }
  }
  audio.onerror = () => { if (generation === playbackGeneration) stopPlayback(true) }

  try {
    await audio.play()
    if (generation !== playbackGeneration) return
    ttsState = "playing"
  } catch {
    if (generation === playbackGeneration) stopPlayback(true)
  }
}

async function handleTtsToggle(e: CustomEvent, requestedPriority: AudioPlaybackPriority) {
  const detail = e.detail as { text?: string; voice?: string; provider?: string; replacePlayback?: boolean; requestId?: string } | undefined
  const settings = getAudioSettings()
  if (requestedPriority === "autoplay" && !settings.ttsAutoPlay) return
  const alreadyOwnsPriority = activePlaybackLease?.priority === requestedPriority
  const now = Date.now()
  const isDoubleClick = requestedPriority === "manual" && !detail?.replacePlayback && now - lastDblClick < 400
  if (requestedPriority === "manual" && !detail?.replacePlayback) lastDblClick = now

  // Double-click: full stop + reset
  if (isDoubleClick) {
    stopPlayback(true)
    return
  }

  // If playing → pause
  if (requestedPriority === "manual" && alreadyOwnsPriority && !detail?.replacePlayback && ttsState === "playing" && currentAudio) {
    currentAudio.pause()
    ttsState = "paused"
    return
  }

  // If paused → resume
  if (requestedPriority === "manual" && alreadyOwnsPriority && !detail?.replacePlayback && ttsState === "paused" && currentAudio) {
    currentAudio.play()
    ttsState = "playing"
    return
  }

  // If loading, ignore
  if (ttsState === "loading" && alreadyOwnsPriority && !detail?.replacePlayback) return

  const text = detail?.text
  if (!text) return

  const priority = requestedPriority
  const lease = playbackCoordinator?.acquire(priority, () => stopPlayback(true))
  if (!lease) return
  activePlaybackLease = lease
  const generation = ++playbackGeneration
  activePreviewId = detail?.requestId
  ttsAborted = false
  playedPaths = []
  ttsState = "loading"
  const provider = detail?.provider ?? settings.ttsProvider
  const language = resolveSpeechLanguage({
    preference: settings.sttLanguage,
    applicationLocale: document.documentElement.lang,
  })
  const voice = detail?.voice ?? settings.voiceByLanguage[language] ?? (language === "en" ? "alba" : "")
  const speed = settings.ttsSpeed || 1.0

  const t0 = performance.now()

  // Split into sentence chunks. First chunk is ultra-short for fast TTFA.
  // For multi-chunk texts, C0 and C1 are launched in parallel so C1 is
  // ready when C0 audio finishes playing (zero gap between chunks).
  const chunks = splitIntoChunks(text)
  if (chunks.length === 0) { stopPlayback(); return }

  console.log(`[TTS] ${chunks.length} chunk(s) (${provider}), voice: ${voice}, ${text.length} chars`)

  // Shift C0 AND C1 out, launch their synth in parallel. C2+ stays in chunkQueue.
  const firstText = chunks.shift()!
  const secondText = chunks.shift()
  chunkQueue = chunks

  try {
    const synth1Promise = synthesizeChunk(firstText, voice, language, provider)

    // Launch C1 synth in PARALLEL with C0 (the server handles concurrent requests).
    // This eliminates the gap between C0 playback end and C1 ready.
    let synth2Promise: Promise<string> | null = null
    if (secondText) {
      synth2Promise = synthesizeChunk(secondText, voice, language, provider)
      // Attach a no-op catch immediately so a failure doesn't become an unhandled
      // rejection if synth1 throws before we wire up the real handlers below.
      synth2Promise.catch(() => {})
    }

    const firstPath = await synth1Promise
    if (generation !== playbackGeneration) return
    console.log(`[TTS] First chunk in ${Math.round(performance.now() - t0)}ms (${firstText.length} chars)`)
    if (ttsAborted) return
    prefetchedPath = firstPath

    // Wire C1 synth as the next prefetch so playNextChunk consumes it after C0.
    if (synth2Promise) {
      const s2 = synth2Promise
      prefetchPromise = s2
      s2.then(path => {
        if (generation !== playbackGeneration) return
        if (prefetchPromise === s2) {
          prefetchedPath = path
          prefetchPromise = null
        }
      }).catch(() => {
        if (generation !== playbackGeneration) return
        if (prefetchPromise === s2) {
          prefetchedPath = null
          prefetchPromise = null
        }
      })
    }

    await playNextChunk(voice, language, speed, provider, generation)
    console.log(`[TTS] Time-to-first-audio: ${Math.round(performance.now() - t0)}ms`)
  } catch (e) {
    console.error("[TTS] Failed:", e)
    if (generation === playbackGeneration) stopPlayback(true)
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function insertTextInEditor(text: string) {
  const editor = document.querySelector("[data-component='prompt-input'][contenteditable='true']") as HTMLDivElement
  if (!editor) return
  editor.focus()
  document.execCommand("insertText", false, text)
}
