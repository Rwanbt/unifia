/**
 * Mobile speech hooks.
 *
 * STT and Android Live use on-device Parakeet. Mobile read-aloud goes through
 * the canonical Android TTS router (local neural voices only, no platform
 * voice) and plays through WebAudio, so the microphone stays shut.
 */

import { invokeTauri } from "../../../app/src/hooks/speech-tauri-adapter"
import { emitSpeech, onSpeech, speechEvents } from "../../../app/src/voice/speech-events"
import { speakableText } from "../../../app/src/hooks/web-speech"
import {
  AudioPlaybackCoordinator,
  type AudioPlaybackLease,
  type AudioPlaybackPriority,
} from "../../../app/src/voice/audio-playback-coordinator"
import { loadAudioSettings } from "../../../app/src/voice/audio-settings"
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
let speechUnsubscribes: (() => void)[] = []
let activeLivePlayback: { id: string; lease: AudioPlaybackLease } | undefined

export function initSpeechListeners() {
  captureCoordinatorCleanup ??= installAudioCaptureCoordinator(window)
  playbackCoordinator ??= new AudioPlaybackCoordinator()
  speechUnsubscribes = [
    onSpeech(window, speechEvents.ttsToggle, (detail) => { void handleTtsToggle(detail) }),
    onSpeech(window, speechEvents.ttsAutoplay, (detail) => { void handleTtsAutoplay(detail) }),
    onSpeech(window, speechEvents.ttsLiveStart, handleLivePlaybackStarted),
    onSpeech(window, speechEvents.ttsLiveEnded, handleLivePlaybackEnded),
  ]
  void preloadModels()
}

export function cleanupSpeechListeners() {
  for (const unsubscribe of speechUnsubscribes) unsubscribe()
  speechUnsubscribes = []
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

async function handleTtsToggle(detail: { text?: string }) {
  const text = speakableText(String(detail?.text ?? ""))
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
  await startManualPlayback(text, "manual")
}

async function handleTtsAutoplay(detail: { text?: string }) {
  if (!loadAudioSettings(window.localStorage).ttsAutoPlay || activeManualPlayback) return
  const text = speakableText(String(detail?.text ?? ""))
  if (text) await startManualPlayback(text, "autoplay")
}

async function startManualPlayback(text: string, priority: AudioPlaybackPriority) {
  let playback: ManualPlayback
  const lease = playbackCoordinator?.acquire(priority, () => stopManualPlayback(playback))
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
    // DIAG: the WebView console never reaches logcat; write_debug_log does.
    const diag = (message: string) => void invokeTauri("write_debug_log", { message: `[read-tts] ${message}` }).catch(() => undefined)
    const startedAt = Date.now()
    let chunks = 0
    let audioMs = 0
    let gaps = 0
    let gapTotalMs = 0
    let minLeadMs = Infinity
    diag(`start chars=${text.length}`)
    playback.player = createWebAudioPcmPlayer(undefined, ({ gapMs, leadMs, chunkMs }) => {
      chunks++
      audioMs += chunkMs
      if (chunks === 1) diag(`first audio after ${Date.now() - startedAt}ms`)
      else if (gapMs > 20) {
        gaps++
        gapTotalMs += gapMs
        diag(`gap ${Math.round(gapMs)}ms before chunk ${chunks} at audio ${Math.round(audioMs / 1000)}s`)
      }
      if (chunks > 1) minLeadMs = Math.min(minLeadMs, leadMs - chunkMs)
    })
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
    diag(`synthesis done chunks=${chunks} audio=${Math.round(audioMs)}ms wall=${Date.now() - startedAt}ms gaps=${gaps} gapTotal=${Math.round(gapTotalMs)}ms minLead=${Math.round(minLeadMs)}ms`)
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
    emitSpeech(window, speechEvents.speechEnded, { kind: "tts", reason: "error" })
  }
}

function stopManualPlayback(playback: ManualPlayback) {
  if (activeManualPlayback !== playback) return
  playback.controller.abort()
  playback.player?.stop()
  activeManualPlayback = undefined
  if (manualPlaybackLease?.id === playback.lease.id) manualPlaybackLease = undefined
  playbackCoordinator?.release(playback.lease)
  emitSpeech(window, speechEvents.speechEnded, { kind: "tts", reason: "done" })
}

function finishManualPlayback(playback: ManualPlayback, reason: "done" | "error") {
  if (activeManualPlayback !== playback) return
  playback.player?.stop()
  activeManualPlayback = undefined
  if (manualPlaybackLease?.id === playback.lease.id) manualPlaybackLease = undefined
  playbackCoordinator?.release(playback.lease)
  emitSpeech(window, speechEvents.speechEnded, { kind: "tts", reason })
}

// The manual read-aloud language used to be derived here from
// document.documentElement.lang. It is now `resolveTtsSelection()`, which also
// returns the conditioning sample and honours the `ttsLanguage` setting, so
// this function had no callers left.

function handleLivePlaybackStarted(detail: { id?: string; stop?: () => void }) {
  if (!detail?.id || typeof detail.stop !== "function") return
  const lease = playbackCoordinator?.acquire("live", detail.stop)
  if (lease) activeLivePlayback = { id: detail.id, lease }
}

function handleLivePlaybackEnded(detail: { id?: string }) {
  const id = detail?.id
  if (!activeLivePlayback || id !== activeLivePlayback.id) return
  playbackCoordinator?.release(activeLivePlayback.lease)
  activeLivePlayback = undefined
}
