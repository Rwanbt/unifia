/* SPDX-License-Identifier: MIT */
import type { TtsRouter } from "@unifia/contracts/tts-router"
import { PocketAndroidBackend } from "./pocket-android-tts"
import { createTtsRouter } from "./tts-router"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/**
 * The one TTS router Android speaks through — Live and read-aloud alike.
 * Only local neural backends are registered (Pocket; ADR-062). There is
 * deliberately no platform (Google) voice: a language without an installed
 * Pocket pack reports MODEL_MISSING and callers say speech is unavailable.
 */
export function createAndroidTtsRouter(invoke: TauriInvoke): TtsRouter {
  return createTtsRouter([new PocketAndroidBackend(invoke)])
}
