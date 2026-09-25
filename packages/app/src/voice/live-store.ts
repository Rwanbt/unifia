/* SPDX-License-Identifier: MIT */
import type { LiveVoiceState } from "@unifia/contracts/speech"
import { createSignal } from "solid-js"
import { requestAudioCapture } from "./audio-capture-coordinator"
import { loadAudioSettings } from "./audio-settings"
import { type LiveContext, type LocalVoiceTransport, LiveVoiceController } from "./live-controller"
import type { LiveHostClient } from "./live-host"
import { INITIAL_LIVE_SNAPSHOT, isLiveActive, type LiveSnapshot } from "./live-state"
import { createLiveKitRoom } from "./livekit-room"

/**
 * One Live conversation per window. The composer remounts when the first
 * voice turn creates a session and the app navigates to it; the conversation
 * must survive that, so the controller lives here and the composer only
 * binds the current server connection and navigation to it. Every Live
 * control (composer button, topbar orb) toggles through `toggleLive`, so they
 * always drive the same conversation.
 */
export interface LiveRuntime {
  host: LiveHostClient
  localVoice?: LocalVoiceTransport
  onSession: (sessionID: string) => void
  /** The session, agent and model a new conversation starts with. */
  context: () => LiveContext
  /** Whether Live can start here (microphone present, enabled in settings). */
  available: boolean
  /** Runs before Live takes the microphone, e.g. to finalize a dictation. */
  beforeStart?: () => void
}

let runtime: LiveRuntime | undefined
let controller: LiveVoiceController | undefined
const [state, setState] = createSignal<LiveVoiceState>("idle")
const [details, setDetails] = createSignal<LiveSnapshot>(INITIAL_LIVE_SNAPSHOT)
const [available, setAvailable] = createSignal(false)

export const liveState = state
export const liveDetails = details
/** True once a composer has bound a runtime that can start Live. */
export const liveAvailable = available

export function bindLiveRuntime(next: LiveRuntime) {
  runtime = next
  setAvailable(next.available)
}

/** Starts a conversation with the bound composer's context, or ends the current one. */
export function toggleLive() {
  const controller = liveController()
  if (isLiveActive(controller.state)) {
    void controller.stop()
    return
  }
  if (!runtime?.available) return
  controller.reset()
  runtime.beforeStart?.()
  void controller.start(runtime.context())
}

export function liveController(): LiveVoiceController {
  if (controller) return controller
  const current = () => {
    if (!runtime) throw new Error("Live voice runtime is not bound")
    return runtime
  }
  controller = new LiveVoiceController({
    host: {
      prepare: (settings) => current().host.prepare(settings),
      requestGrant: (request) => current().host.requestGrant(request),
      release: (binding) => current().host.release(binding),
    },
    localVoice: current().localVoice,
    createRoom: createLiveKitRoom,
    settings: () => loadAudioSettings(),
    captureMicrophone: (stop) => requestAudioCapture(window, "live", stop),
    playback: {
      start: (id, stop) => window.dispatchEvent(new CustomEvent("tts-live-start", { detail: { id, stop } })),
      end: (id) => window.dispatchEvent(new CustomEvent("tts-live-ended", { detail: { id } })),
    },
    onSession: (sessionID) => runtime?.onSession(sessionID),
    log: (message, data) => console.info(`[Live] ${message}`, data ?? {}),
  })
  controller.subscribe((next, snapshot) => {
    setState(next)
    setDetails(snapshot)
  })
  return controller
}
