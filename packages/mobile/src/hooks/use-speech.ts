/**
 * Mobile speech hooks.
 *
 * STT and Android Live use on-device Parakeet. Mobile read-aloud uses an
 * installed Android voice that reports local execution.
 */

import { invokeTauri } from "../../../app/src/hooks/speech-tauri-adapter"
import { speakableText } from "../../../app/src/hooks/web-speech"
import { AudioPlaybackCoordinator, type AudioPlaybackLease } from "../../../app/src/voice/audio-playback-coordinator"
import { AndroidOfflineTts } from "../../../app/src/voice/android-offline-tts"
import { loadAudioSettings } from "../../../app/src/voice/audio-settings"
import { acquireCurrentAudioStream, cancelAudioCaptureRequest, installAudioCaptureCoordinator, requestAudioCapture, type AudioCaptureLease } from "../../../app/src/voice/audio-capture-coordinator"
import { showToast } from "@unifia/ui/toast"

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let captureLease: AudioCaptureLease | undefined
let captureStream: MediaStream | undefined
let captureStartedAt = 0
let discardDictationCapture = false
let finalizingDictation = false
let captureCoordinatorCleanup: (() => void) | undefined
let playbackCoordinator: AudioPlaybackCoordinator | undefined
let activeManualPlayback: ManualPlayback | undefined
let manualPlaybackLease: AudioPlaybackLease | undefined
let lastManualToggleAt = 0

type ManualPlayback = {
  synthesisPending: boolean
  lease: AudioPlaybackLease
  nativeTts?: AndroidOfflineTts
}
const MANUAL_TTS_DOUBLE_TAP_MS = 400
let ttsToggleListener: EventListener | undefined
let activeLivePlayback: { id: string; lease: AudioPlaybackLease } | undefined

export function initSpeechListeners() {
  captureCoordinatorCleanup ??= installAudioCaptureCoordinator(window)
  playbackCoordinator ??= new AudioPlaybackCoordinator()
  window.addEventListener("stt-start", handleSttStart)
  window.addEventListener("stt-stop", handleSttStop)
  ttsToggleListener = ((e: Event) => { void handleTtsToggle(e as CustomEvent) }) as EventListener
  window.addEventListener("tts-toggle", ttsToggleListener)
  window.addEventListener("tts-live-start", handleLivePlaybackStarted)
  window.addEventListener("tts-live-ended", handleLivePlaybackEnded)
  void preloadModels()
}

export function cleanupSpeechListeners() {
  window.removeEventListener("stt-start", handleSttStart)
  window.removeEventListener("stt-stop", handleSttStop)
  if (ttsToggleListener) window.removeEventListener("tts-toggle", ttsToggleListener)
  ttsToggleListener = undefined
  window.removeEventListener("tts-live-start", handleLivePlaybackStarted)
  window.removeEventListener("tts-live-ended", handleLivePlaybackEnded)
  stopDictationCapture()
  playbackCoordinator?.stop()
  playbackCoordinator = undefined
  activeManualPlayback = undefined
  manualPlaybackLease = undefined
  activeLivePlayback = undefined
  captureCoordinatorCleanup?.()
  captureCoordinatorCleanup = undefined
}

async function preloadModels() {
  try {
    const available = await invokeTauri("stt_available")
    if (available) await invokeTauri("stt_load_model")
  } catch (e) {
    console.warn("[STT] Pre-load failed:", e)
  }
}

// ─── STT ───────────────────────────────────────────────────────────────

async function handleSttStart() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") return
  let stream: MediaStream | undefined
  let lease: AudioCaptureLease | undefined
  try {
    const acquiredLease = requestAudioCapture(window, "dictation", stopDictationCapture)
    if (!acquiredLease) {
      window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "stt", reason: "error" } }))
      return
    }
    lease = acquiredLease
    captureLease = lease
    const acquiredStream = await acquireCurrentAudioStream(lease, () => navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: { ideal: 16000 }, channelCount: 1 },
    }))
    if (!acquiredStream) return
    stream = acquiredStream
    captureStream = acquiredStream
    audioChunks = []
    discardDictationCapture = false
    mediaRecorder = new MediaRecorder(acquiredStream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    })

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      finalizingDictation = false
      acquiredStream.getTracks().forEach((t) => t.stop())
      captureStream = undefined
      if (captureLease?.id === lease?.id) captureLease = undefined
      lease?.release()
      if (discardDictationCapture) {
        discardDictationCapture = false
        audioChunks = []
        window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "stt", reason: "done" } }))
        return
      }
      if (audioChunks.length === 0) {
        window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "stt", reason: "done" } }))
        return
      }

      const blob = new Blob(audioChunks, { type: mediaRecorder!.mimeType })

      try {
        const recordingMs = Math.round(performance.now() - captureStartedAt)
        const conversionStartedAt = performance.now()
        const available = await invokeTauri("stt_available")
        if (!available) {
          await invokeTauri("stt_download_model")
        }

        const wavBase64 = await blobToWavBase64(blob)
        const conversionAndModelMs = Math.round(performance.now() - conversionStartedAt)
        const inferenceStartedAt = performance.now()
        const text: string = await invokeTauri("stt_transcribe", { audioBase64: wavBase64 })
        console.info("[STT] Capture pipeline metrics", {
          recordingMs,
          webmBytes: blob.size,
          wavBase64Characters: wavBase64.length,
          conversionAndModelMs,
          inferenceMs: Math.round(performance.now() - inferenceStartedAt),
        })
        if (text.trim()) insertTextInEditor(text.trim())
      } catch (e) {
        console.error("[STT] Failed:", e)
        window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "stt", reason: "error" } }))
      }
    }

    mediaRecorder.start(250)
    captureStartedAt = performance.now()
  } catch (e) {
    console.error("[STT] Mic access failed:", e)
    if (lease && !lease.isCurrent()) return
    stream?.getTracks().forEach((track) => track.stop())
    lease?.release()
    if (captureLease?.id === lease?.id) captureLease = undefined
    if (captureStream === stream) captureStream = undefined
    const name = (e as { name?: string } | null)?.name
    window.dispatchEvent(new CustomEvent("speech-ended", {
      detail: { kind: "stt", reason: name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "error" },
    }))
    // Reset the recording signal so the UI button doesn't stay stuck in "stop"
    window.dispatchEvent(new CustomEvent("stt-start-failed"))
  }
}

function handleSttStop() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    finalizingDictation = true
    mediaRecorder.stop()
    return
  }
  cancelAudioCaptureRequest(captureLease, captureStream)
  captureLease = undefined
  captureStream = undefined
  audioChunks = []
}

function stopDictationCapture() {
  // An explicit stop is already transcribing: Live taking the microphone must
  // not discard it — the dictated text still lands in the prompt.
  if (finalizingDictation) return
  discardDictationCapture = true
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop()
  } else {
    cancelAudioCaptureRequest(captureLease, captureStream)
    captureStream = undefined
    captureLease = undefined
  }
}

async function handleTtsToggle(e: CustomEvent) {
  const text = speakableText(String(e.detail?.text ?? ""))
  if (!text) return
  const active = activeManualPlayback
  const now = Date.now()
  const doubleTap = now - lastManualToggleAt < MANUAL_TTS_DOUBLE_TAP_MS
  lastManualToggleAt = now
  if (active) {
    if (doubleTap || active.synthesisPending) {
      stopManualPlayback(active)
      return
    }
    if (active.nativeTts) {
      if (speechSynthesis.paused) active.nativeTts.resume()
      else active.nativeTts.pause()
      return
    }
    return
  }
  await startManualPlayback(text)
}

async function startManualPlayback(text: string) {
  let playback: ManualPlayback
  const lease = playbackCoordinator?.acquire("manual", () => stopManualPlayback(playback))
  if (!lease) return
  playback = {
    synthesisPending: true,
    lease,
  }
  activeManualPlayback = playback
  manualPlaybackLease = lease
  playback.nativeTts = new AndroidOfflineTts()
  try {
    const language = speechLanguage()
    await playback.nativeTts.prepare(language)
    if (activeManualPlayback !== playback) return
    playback.synthesisPending = false
    await playback.nativeTts.speak(text, language, loadAudioSettings().ttsSpeed)
    if (activeManualPlayback === playback) finishManualPlayback(playback, "done")
    return
  } catch (error) {
    if (activeManualPlayback !== playback) return
    stopManualPlayback(playback)
    console.error("[TTS] On-device mobile read-aloud failed:", error)
    showToast({ title: "Offline speech unavailable", description: "Install an offline Android voice for this language and try again.", variant: "error" })
    window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "tts", reason: "error" } }))
    return
  }
}

function stopManualPlayback(playback: ManualPlayback) {
  if (activeManualPlayback !== playback) return
  playback.nativeTts?.stop()
  activeManualPlayback = undefined
  if (manualPlaybackLease?.id === playback.lease.id) manualPlaybackLease = undefined
  playbackCoordinator?.release(playback.lease)
  window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "tts", reason: "done" } }))
}

function finishManualPlayback(playback: ManualPlayback, reason: "done" | "error") {
  if (activeManualPlayback !== playback) return
  playback.nativeTts?.stop()
  activeManualPlayback = undefined
  if (manualPlaybackLease?.id === playback.lease.id) manualPlaybackLease = undefined
  playbackCoordinator?.release(playback.lease)
  window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "tts", reason } }))
}

function speechLanguage(): "en" | "fr" | "es" | "it" | "de" {
  const language = (document.documentElement.lang || navigator.language || "en").toLowerCase().slice(0, 2)
  return ["en", "fr", "es", "it", "de"].includes(language) ? language as "en" | "fr" | "es" | "it" | "de" : "en"
}

function handleLivePlaybackStarted(event: Event) {
  const detail = (event as CustomEvent<{ id?: string; stop?: () => void }>).detail
  if (!detail?.id || typeof detail.stop !== "function") return
  const lease = playbackCoordinator?.acquire("live", detail.stop)
  if (lease) activeLivePlayback = { id: detail.id, lease }
}

function handleLivePlaybackEnded(event: Event) {
  const id = (event as CustomEvent<{ id?: string }>).detail?.id
  if (!activeLivePlayback || id !== activeLivePlayback.id) return
  playbackCoordinator?.release(activeLivePlayback.lease)
  activeLivePlayback = undefined
}
// ─── Helpers ───────────────────────────────────────────────────────────

function insertTextInEditor(text: string) {
  const editor = document.querySelector("[data-component='prompt-input'][contenteditable='true']") as HTMLDivElement
  if (!editor) return
  editor.focus()
  document.execCommand("insertText", false, text)
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext({ sampleRate: 16000 })
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  await audioCtx.close()

  const samples = audioBuffer.getChannelData(0)
  const targetRate = 16000
  const resampled = audioBuffer.sampleRate !== targetRate
    ? resample(samples, audioBuffer.sampleRate, targetRate)
    : samples

  const wavBuffer = encodeWav(resampled, targetRate)
  return arrayBufferToBase64(wavBuffer)
}

function resample(samples: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to
  const len = Math.round(samples.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const idx = i * ratio
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, samples.length - 1)
    const frac = idx - lo
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac
  }
  return out
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
