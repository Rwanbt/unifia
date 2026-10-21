/**
 * Mobile speech hooks.
 *
 * STT and Android Live use on-device Parakeet. Mobile read-aloud goes through
 * the canonical Android TTS router (local neural voices only, no platform
 * voice) and plays through WebAudio, so the microphone stays shut.
 */

import { invokeTauri } from "../../../app/src/hooks/speech-tauri-adapter"
import { speakableText } from "../../../app/src/hooks/web-speech"
import { AudioPlaybackCoordinator, type AudioPlaybackLease } from "../../../app/src/voice/audio-playback-coordinator"
import { createAndroidTtsRouter } from "../../../app/src/voice/android-tts-router"
import { createWebAudioPcmPlayer, type PcmPlayer } from "../../../app/src/voice/webaudio-pcm-player"
import type { TtsRouter } from "@unifia/contracts/tts-router"
import { resolveTtsSelection } from "../../../app/src/voice/tts-selection"
import { installAudioCaptureCoordinator } from "../../../app/src/voice/audio-capture-coordinator"
import { showToast } from "@unifia/ui/toast"

let captureCoordinatorCleanup: (() => void) | undefined
let playbackCoordinator: AudioPlaybackCoordinator | undefined
let activeManualPlayback: ManualPlayback | undefined
let manualPlaybackLease: AudioPlaybackLease | undefined
let lastManualToggleAt = 0

type ManualPlayback = {
  synthesisPending: boolean
  lease: AudioPlaybackLease
  controller: AbortController
  player?: PcmPlayer
}
let manualRouter: TtsRouter | undefined
const MANUAL_TTS_DOUBLE_TAP_MS = 400
let ttsToggleListener: EventListener | undefined
let activeLivePlayback: { id: string; lease: AudioPlaybackLease } | undefined

export function initSpeechListeners() {
  captureCoordinatorCleanup ??= installAudioCaptureCoordinator(window)
  playbackCoordinator ??= new AudioPlaybackCoordinator()
  ttsToggleListener = ((e: Event) => { void handleTtsToggle(e as CustomEvent) }) as EventListener
  window.addEventListener("tts-toggle", ttsToggleListener)
  window.addEventListener("tts-live-start", handleLivePlaybackStarted)
  window.addEventListener("tts-live-ended", handleLivePlaybackEnded)
  void preloadModels()
}

export function cleanupSpeechListeners() {
  if (ttsToggleListener) window.removeEventListener("tts-toggle", ttsToggleListener)
  ttsToggleListener = undefined
  window.removeEventListener("tts-live-start", handleLivePlaybackStarted)
  window.removeEventListener("tts-live-ended", handleLivePlaybackEnded)
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
    if (active.player) {
      if (active.player.paused) void active.player.resume()
      else void active.player.pause()
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
    controller: new AbortController(),
  }
  activeManualPlayback = playback
  manualPlaybackLease = lease
  // Resolved before the try so the error toast can name the language that was
  // actually requested, rather than the one the interface implies.
  //
  // WHY the voice is resolved here at all: this is the manual read-aloud path,
  // and it builds its own request. Leaving `voice` off made the request fall
  // back to the pack default, which the French pack deliberately does not
  // have, so read-aloud failed with "Pocket voice unavailable" while Live,
  // wired earlier, honoured the same setting. Both paths now go through
  // resolveTtsSelection so a choice in the settings applies everywhere.
  const selection = resolveTtsSelection()
  try {
    manualRouter ??= createAndroidTtsRouter(invokeTauri)
    playback.player = createWebAudioPcmPlayer()
    const request = {
      id: `manual-${Date.now()}`,
      text,
      language: selection.language,
      voice: selection.voice,
      speed: selection.speed,
    }
    for await (const event of manualRouter.synthesize(request, playback.controller.signal)) {
      if (activeManualPlayback !== playback) return
      if ("code" in event) {
        if (!event.recoverable) throw Object.assign(new Error(event.detail), { code: event.code })
        continue
      }
      playback.synthesisPending = false
      playback.player.enqueue(event)
    }
    if (activeManualPlayback !== playback) return
    await playback.player.drain()
    if (activeManualPlayback === playback) finishManualPlayback(playback, "done")
  } catch (error) {
    if (activeManualPlayback !== playback) return
    stopManualPlayback(playback)
    console.error("[TTS] On-device mobile read-aloud failed:", error)
    showToast({
      title: "Pocket voice unavailable",
      description: `The on-device Pocket voice for "${selection.language}" is not installed yet, so this message cannot be read aloud.`,
      variant: "error",
    })
    window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "tts", reason: "error" } }))
  }
}

function stopManualPlayback(playback: ManualPlayback) {
  if (activeManualPlayback !== playback) return
  playback.controller.abort()
  playback.player?.stop()
  activeManualPlayback = undefined
  if (manualPlaybackLease?.id === playback.lease.id) manualPlaybackLease = undefined
  playbackCoordinator?.release(playback.lease)
  window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "tts", reason: "done" } }))
}

function finishManualPlayback(playback: ManualPlayback, reason: "done" | "error") {
  if (activeManualPlayback !== playback) return
  playback.player?.stop()
  activeManualPlayback = undefined
  if (manualPlaybackLease?.id === playback.lease.id) manualPlaybackLease = undefined
  playbackCoordinator?.release(playback.lease)
  window.dispatchEvent(new CustomEvent("speech-ended", { detail: { kind: "tts", reason } }))
}

// The manual read-aloud language used to be derived here from
// document.documentElement.lang. It is now `resolveTtsSelection()`, which also
// returns the conditioning sample and honours the `ttsLanguage` setting, so
// this function had no callers left.

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
