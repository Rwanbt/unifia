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
}

export function createNativeDictation(invoke: Invoke, pumpMs = NATIVE_DICTATION_PUMP_MS): NativeDictation {
  let pump: ReturnType<typeof setInterval> | undefined
  const stopPump = () => {
    if (pump !== undefined) clearInterval(pump)
    pump = undefined
  }
  return {
    async start() {
      await invoke("voice_audio_dictation_start")
      pump = setInterval(() => {
        void invoke("voice_audio_poll").catch(() => undefined)
      }, pumpMs)
    },
    async finish() {
      stopPump()
      const text = await invoke("voice_audio_dictation_finish")
      return typeof text === "string" ? text : ""
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
