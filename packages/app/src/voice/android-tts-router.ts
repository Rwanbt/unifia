/* SPDX-License-Identifier: MIT */
import type { TtsBackend, TtsRouter } from "@unifia/contracts/tts-router"
import { PocketAndroidBackend } from "./pocket-android-tts"
import { createTtsRouter } from "./tts-router"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/**
 * Every TTS backend the shipped Android path is allowed to speak through.
 *
 * Exported so the readiness guard can assert on the *live* registration list
 * instead of a hand-written inventory that could drift from this function.
 * A backend that is not listed here does not reach the shipped path.
 */
export function androidShippedTtsBackends(invoke: TauriInvoke): readonly TtsBackend[] {
  return [new PocketAndroidBackend(invoke)]
}

/**
 * The one TTS router Android speaks through — Live and read-aloud alike.
 * Only local neural backends are registered (Pocket; ADR-062). There is
 * deliberately no platform (Google) voice: a language without an installed
 * Pocket pack reports MODEL_MISSING and callers say speech is unavailable.
 */
export function createAndroidTtsRouter(invoke: TauriInvoke): TtsRouter {
  return createTtsRouter(androidShippedTtsBackends(invoke))
}
