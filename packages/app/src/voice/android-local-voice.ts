/* SPDX-License-Identifier: MIT */
import type { LocalVoiceAudioDiagnostics, LocalVoiceTransport } from "./live-controller"
import { createAndroidTtsRouter } from "./android-tts-router"
import { AudioPlaybackCoordinator } from "./audio-playback-coordinator"
import { createAndroidSpeechOutput } from "./android-speech-output"
import { loadAudioSettings } from "./audio-settings"
import { runNativeVoiceStep } from "./native-voice-error"
import type { SpeechLanguage } from "@unifia/contracts/speech"
import { isSpeechLanguage } from "@unifia/contracts/speech"

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

/**
 * Speech language and conditioning sample, resolved from the saved settings.
 *
 * The pack is chosen by language and the speaker by the prompt, so both are
 * read here rather than derived from the interface. `ttsLanguage: "auto"`
 * keeps the previous behaviour of following `document.lang`, which is what
 * every record written before the setting existed means.
 */
function resolveTtsSelection(): { language: SpeechLanguage; voice: string | undefined } {
  const settings = loadAudioSettings()
  const auto = (document.documentElement.lang || navigator.language || "en")
    .slice(0, 2)
    .toLowerCase()
  // An interface language with no speech pack falls back to English rather
  // than indexing the voice table with a language that has no entry.
  const language: SpeechLanguage =
    settings.ttsLanguage === "auto"
      ? isSpeechLanguage(auto)
        ? auto
        : "en"
      : settings.ttsLanguage
  return { language, voice: settings.voiceByLanguage[language] }
}

/** Android Oboe capture, local Parakeet inference and installed offline TTS. */
export function createAndroidLocalVoiceTransport(invoke: TauriInvoke): LocalVoiceTransport {  let handlers: {
    onSpeaking(speaking: boolean): void
    onUtterance(audio: string): void
    onError?(error: unknown): void
    onAudioDiagnostics?(stats: LocalVoiceAudioDiagnostics): void
  } | undefined
  const coordinator = new AudioPlaybackCoordinator()
  const speech = createAndroidSpeechOutput({
    invoke,
    router: createAndroidTtsRouter(invoke),
    coordinator,
  })
  let stopped = true
  let audioOpened = false
  let polling = false
  let previousSpeaking = false
  let lastDiagnosticsAt = 0

  function stopTransport() {
    if (stopped) return
    stopped = true
    speech.stop()
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
            ttsBackend: speech.lastBackend,
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
        // The pack is chosen by speech language, not by interface language:
        // `ttsLanguage` lets a French interface speak English and vice versa.
        const { language, voice } = resolveTtsSelection()
        // Speech readiness must never gate capture: a missing system voice or
        // an absent neural backend degrades at speak time with a labelled
        // fallback instead of failing Live startup before the mic opens.
        await speech.prepare(language, voice)
        if (stopped) return
        const available = await invoke("stt_available")
        if (stopped) return
        if (available !== true) await runNativeVoiceStep("stt-download", () => invoke("stt_download_model"))
        if (stopped) return
        await runNativeVoiceStep("stt-load", () => invoke("stt_load_model"))
        if (stopped) return
        // WebView permission UI is used only to obtain RECORD_AUDIO consent.
        // The short-lived WebView stream is closed before Oboe opens capture.
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        permissionStream.getTracks().forEach((track) => track.stop())
        if (stopped) {
          return
        }
        await runNativeVoiceStep("audio-open", () => invoke("voice_audio_open"))
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
      const result = await runNativeVoiceStep("stt-transcribe", () =>
        invoke("voice_audio_transcribe_utterance", { utteranceId: utteranceID }),
      )
      if (typeof result !== "string") throw new Error("Local Parakeet returned an invalid transcript")
      return result
    },
    async speak(text) {
      const { language, voice } = resolveTtsSelection()
      // The backend that actually spoke is reported through the audio
      // diagnostics (`ttsBackend`), because LocalVoiceTransport.speak is
      // fixed to Promise<void>. That keeps "which engine spoke" observable
      // without ever letting a system voice be reported as Pocket.
      await speech.speak(text, language, loadAudioSettings().ttsSpeed, "live", voice)
    },
    stop() {
      stopTransport()
    },
    stopSpeaking() {
      speech.stop()
    },
  }

}
