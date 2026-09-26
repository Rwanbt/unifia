/* SPDX-License-Identifier: MIT */
import type { LocalVoiceTransport } from "./live-controller"
import { AndroidOfflineTts } from "./android-offline-tts"
import { loadAudioSettings } from "./audio-settings"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
type NativeAudioPoll = { speaking: boolean; utterance_id: string | null; audio_clock_ms: number }

/** Android Oboe capture, local Parakeet inference and installed offline TTS. */
export function createAndroidLocalVoiceTransport(invoke: TauriInvoke): LocalVoiceTransport {
  let handlers: { onSpeaking(speaking: boolean): void; onUtterance(audio: string): void; onError?(error: unknown): void } | undefined
  const tts = new AndroidOfflineTts()
  let stopped = true
  let audioOpened = false
  let polling = false
  let previousSpeaking = false

  async function pollAudio() {
    if (polling) return
    polling = true
    try {
      while (!stopped) {
        const poll = await invoke("voice_audio_poll") as NativeAudioPoll
        if (stopped) break
        if (poll.speaking !== previousSpeaking) {
          previousSpeaking = poll.speaking
          handlers?.onSpeaking(poll.speaking)
        }
        if (poll.utterance_id) handlers?.onUtterance(poll.utterance_id)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } catch (error) {
      if (!stopped) {
        stopped = true
        handlers?.onSpeaking(false)
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
        this.stop()
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
      if (stopped) return
      stopped = true
      handlers?.onSpeaking(false)
      if (audioOpened) void invoke("voice_audio_close").catch((error) => console.error("[Live] Native audio close failed", error))
      audioOpened = false
    },
    stopSpeaking() {
      tts.stop()
    },
  }

}
