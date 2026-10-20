/* SPDX-License-Identifier: MIT */

// On-device dictation for the mobile shell. The microphone is recorded by the
// native audio session and transcribed by the local Parakeet engine on the CPU,
// so no speech audio leaves the device. Browser speech recognition is never used
// here: on Android it is served by a cloud-backed recognizer.

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/** The native capture reads at most one 20 ms chunk per call; pumping every 10 ms keeps it ahead. */
export const NATIVE_DICTATION_PUMP_MS = 10

export type NativeDictation = {
  start(): Promise<void>
  finish(): Promise<string>
  /** Fires once when the native side reports the one-minute cap has been reached. */
  onFull(listener: () => void): void
}

function reachedCap(poll: unknown): boolean {
  return typeof poll === "object" && poll !== null && (poll as { dictation_full?: unknown }).dictation_full === true
}

export function createNativeDictation(invoke: Invoke, pumpMs = NATIVE_DICTATION_PUMP_MS): NativeDictation {
  let pump: ReturnType<typeof setInterval> | undefined
  let pumpFailure: { error: unknown } | undefined
  let pollInFlight = false
  let capReached = false
  const fullListeners: Array<() => void> = []
  const stopPump = () => {
    if (pump !== undefined) clearInterval(pump)
    pump = undefined
  }
  // Skip ticks while a poll is still running, so slow polls never queue up behind each other.
  const pollCapture = () => {
    if (pollInFlight) return
    pollInFlight = true
    void invoke("voice_audio_poll")
      .then((poll) => {
        if (!reachedCap(poll) || capReached) return
        capReached = true
        fullListeners.forEach((listener) => listener())
      })
      .catch((error: unknown) => {
        pumpFailure = { error }
        stopPump()
      })
      .finally(() => {
        pollInFlight = false
      })
  }
  return {
    async start() {
      pumpFailure = undefined
      capReached = false
      await invoke("voice_audio_dictation_start")
      pump = setInterval(pollCapture, pumpMs)
    },
    async finish() {
      stopPump()
      // The native session is closed even when the capture failed; the failure is reported after that.
      const text = await invoke("voice_audio_dictation_finish")
      if (pumpFailure) throw pumpFailure.error
      return typeof text === "string" ? text : ""
    },
    onFull(listener) {
      fullListeners.push(listener)
    },
  }
}

type TauriGlobal = { __TAURI__?: { core?: { invoke?: Invoke } } }

/** The native dictation when running inside the mobile Tauri shell, otherwise undefined. */
export function nativeDictationForRuntime(isMobile: boolean, scope: TauriGlobal = globalThis as TauriGlobal): NativeDictation | undefined {
  const invoke = scope.__TAURI__?.core?.invoke
  if (!isMobile || !invoke) return undefined
  return createNativeDictation((command, args) => invoke(command, args))
}
