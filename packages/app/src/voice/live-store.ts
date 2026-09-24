/* SPDX-License-Identifier: MIT */
import type { LiveVoiceState } from "@unifia/contracts/speech"
import { createSignal } from "solid-js"
import { requestAudioCapture } from "./audio-capture-coordinator"
import { loadAudioSettings } from "./audio-settings"
import { LiveVoiceController } from "./live-controller"
import type { LiveHostClient } from "./live-host"
import { INITIAL_LIVE_SNAPSHOT, type LiveSnapshot } from "./live-state"
import { createLiveKitRoom } from "./livekit-room"

/**
 * One Live conversation per window. The composer remounts when the first
 * voice turn creates a session and the app navigates to it; the conversation
 * must survive that, so the controller lives here and the composer only
 * binds the current server connection and navigation to it.
 */
export interface LiveRuntime {
  host: LiveHostClient
  onSession: (sessionID: string) => void
}

let runtime: LiveRuntime | undefined
let controller: LiveVoiceController | undefined
const [state, setState] = createSignal<LiveVoiceState>("idle")
const [details, setDetails] = createSignal<LiveSnapshot>(INITIAL_LIVE_SNAPSHOT)

export const liveState = state
export const liveDetails = details

export function bindLiveRuntime(next: LiveRuntime) {
  runtime = next
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
