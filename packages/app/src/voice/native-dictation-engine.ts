/* SPDX-License-Identifier: MIT */

import type { DictationEngine } from "./dictation-controller"
import type { NativeDictation } from "../hooks/native-dictation"

/**
 * `DictationEngine` for the mobile shell.
 *
 * The native session already owns capture, voice activity detection, the live
 * preview and the one-minute cap, so the adapter only forwards the lifecycle
 * and the optional streams to the shared controller.
 */
export function createNativeDictationEngine(dictation: NativeDictation): DictationEngine {
  return {
    start: () => dictation.start(),
    finish: () => dictation.finish(),
    // The native session has no separate abort: finishing closes capture and the
    // controller discards the transcript.
    cancel: async () => {
      await dictation.finish()
    },
    onPartial: (listener) => dictation.onPartial(listener),
    onLevel: (listener) => dictation.onLevel(listener),
    onAutoStop: (listener) => dictation.onAutoStop(listener),
  }
}
