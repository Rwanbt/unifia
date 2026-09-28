/* SPDX-License-Identifier: MIT */
import type { TtsRouter } from "@unifia/contracts/tts-router"
import { createTtsRouter } from "./tts-router"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/**
 * The one TTS router Android speaks through — Live and read-aloud alike.
 * Only local neural backends are registered here (Pocket; ADR-062). There is
 * deliberately no platform (Google) voice: without a Pocket runtime the
 * router has no provider and callers report that speech is unavailable.
 */
export function createAndroidTtsRouter(_invoke: TauriInvoke): TtsRouter {
  return createTtsRouter([])
}
