/**
 * Mobile speech hooks.
 *
 * STT: mic → MediaRecorder (webm/opus) → WAV 16 kHz → Parakeet ONNX → text
 * TTS is provided by the Voice Host when a live session is available.
 */

import { invokeTauri } from "../../../app/src/hooks/speech-tauri-adapter"
import { acquireCurrentAudioStream, cancelAudioCaptureRequest, installAudioCaptureCoordinator, requestAudioCapture, type AudioCaptureLease } from "../../../app/src/voice/audio-capture-coordinator"
import { showToast } from "@unifia/ui/toast"

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let captureLease: AudioCaptureLease | undefined
let captureStream: MediaStream | undefined
let captureStartedAt = 0
let discardDictationCapture = false
let captureCoordinatorCleanup: (() => void) | undefined

export function initSpeechListeners() {
  captureCoordinatorCleanup ??= installAudioCaptureCoordinator(window)
  window.addEventListener("stt-start", handleSttStart)
  window.addEventListener("stt-stop", handleSttStop)
  window.addEventListener("tts-toggle", ((e: Event) => { handleTtsToggle(e as CustomEvent) }) as EventListener)
  void preloadModels()
}

export function cleanupSpeechListeners() {
  window.removeEventListener("stt-start", handleSttStart)
  window.removeEventListener("stt-stop", handleSttStop)
  stopDictationCapture()
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
    mediaRecorder.stop()
    return
  }
  cancelAudioCaptureRequest(captureLease, captureStream)
  captureLease = undefined
  captureStream = undefined
  audioChunks = []
}

function stopDictationCapture() {
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
  if (!e.detail?.text) return
  showToast({ title: "Voice Host unavailable", description: "Connect a Voice Host to use speech synthesis.", variant: "error" })
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
