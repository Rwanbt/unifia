/* SPDX-License-Identifier: MIT */
import type { LocalVoiceAudioDiagnostics, LocalVoiceTransport } from "./live-controller"
import { AndroidOfflineTts } from "./android-offline-tts"
import { loadAudioSettings } from "./audio-settings"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
type NativeAudioPoll = {
  speaking: boolean
  utterance_id: string | null
  audio_clock_ms: number
  sample_rate: number
  frames_per_burst: number
  xrun_count: number
  last_error: number
  capture_overflows: number
  playback_overflows: number
  playback_empty_samples: number
  vad_provider: string
  vad_fallback: boolean
  turn_detector: string
  turn_detector_fallback: boolean
  turn_gate_evaluations: number
  turn_gate_vetoes: number
  turn_gate_forced: number
}

/** Android Oboe capture, local Parakeet inference and installed offline TTS. */
export function createAndroidLocalVoiceTransport(invoke: TauriInvoke): LocalVoiceTransport {
  let handlers: {
    onSpeaking(speaking: boolean): void
    onUtterance(audio: string): void
    onError?(error: unknown): void
    onAudioDiagnostics?(stats: LocalVoiceAudioDiagnostics): void
  } | undefined
  const tts = new AndroidOfflineTts()
  let stopped = true
  let audioOpened = false
  let polling = false
  let previousSpeaking = false
  let lastDiagnosticsAt = 0

  function stopTransport() {
    if (stopped) return
    stopped = true
    if (audioOpened) {
      audioOpened = false
      void invoke("voice_audio_close").catch((error) => console.error("[Live] Native audio close failed", error))
    }
    handlers?.onSpeaking(false)
  }

  async function pollAudio() {
    if (polling) return
    polling = true
    try {
      while (!stopped) {
        const poll = await invoke("voice_audio_poll") as NativeAudioPoll
        if (stopped) break
        if (poll.last_error !== 0) throw new Error(`Oboe audio stream failed (${poll.last_error})`)
        if (poll.sample_rate !== 48_000) throw new Error(`Unsupported native audio sample rate (${poll.sample_rate})`)
        const now = Date.now()
        if (now - lastDiagnosticsAt >= 1_000) {
          lastDiagnosticsAt = now
          const diagnostics: LocalVoiceAudioDiagnostics = {
            audioClockMs: poll.audio_clock_ms,
            sampleRate: poll.sample_rate,
            framesPerBurst: poll.frames_per_burst,
            xrunCount: poll.xrun_count,
            lastError: poll.last_error,
            captureOverflows: poll.capture_overflows,
            playbackOverflows: poll.playback_overflows,
            playbackEmptySamples: poll.playback_empty_samples,
            vadProvider: poll.vad_provider,
            vadFallback: poll.vad_fallback,
            turnDetector: poll.turn_detector,
            turnDetectorFallback: poll.turn_detector_fallback,
            turnGateEvaluations: poll.turn_gate_evaluations,
            turnGateVetoes: poll.turn_gate_vetoes,
            turnGateForced: poll.turn_gate_forced,
          }
          handlers?.onAudioDiagnostics?.(diagnostics)
        }
        if (poll.speaking !== previousSpeaking) {
          previousSpeaking = poll.speaking
          handlers?.onSpeaking(poll.speaking)
        }
        if (poll.utterance_id) handlers?.onUtterance(poll.utterance_id)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } catch (error) {
      if (!stopped) {
        stopTransport()
        handlers?.onError?.(error)
      }
    } finally {
      polling = false
    }
  }

  return {
    async start(nextHandlers) {
      if (stopped === false) return
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("Android microphone capture is unavailable")
      stopped = false
      handlers = nextHandlers
      previousSpeaking = false
      try {
        const language = (document.documentElement.lang || navigator.language || "en").slice(0, 2).toLowerCase()
        await tts.prepare(language)
        if (stopped) return
        const available = await invoke("stt_available")
        if (stopped) return
        if (available !== true) await invoke("stt_download_model")
        if (stopped) return
        await invoke("stt_load_model")
        if (stopped) return
        // WebView permission UI is used only to obtain RECORD_AUDIO consent.
        // The short-lived WebView stream is closed before Oboe opens capture.
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        permissionStream.getTracks().forEach((track) => track.stop())
        if (stopped) {
          return
        }
        await invoke("voice_audio_open")
        audioOpened = true
        if (stopped) {
          await invoke("voice_audio_close")
          audioOpened = false
          return
        }
        void pollAudio()
      } catch (error) {
        stopTransport()
        throw error
      }
    },
    async transcribe(utteranceID) {
      const result = await invoke("voice_audio_transcribe_utterance", { utteranceId: utteranceID })
      if (typeof result !== "string") throw new Error("Local Parakeet returned an invalid transcript")
      return result
    },
    speak(text) {
      const language = (document.documentElement.lang || navigator.language || "en").slice(0, 2).toLowerCase()
      return tts.speak(text, language, loadAudioSettings().ttsSpeed)
    },
    stop() {
      stopTransport()
    },
    stopSpeaking() {
      tts.stop()
    },
  }

}
