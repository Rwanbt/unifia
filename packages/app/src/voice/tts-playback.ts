/* SPDX-License-Identifier: MIT */
import type { TtsRequest } from "@unifia/contracts/speech"
import type { TtsAudioChunk, TtsProviderError, TtsRouter } from "@unifia/contracts/tts-router"
import type { AudioPlaybackCoordinator, AudioPlaybackPriority } from "./audio-playback-coordinator"

export interface TtsPlaybackOptions {
  readonly router: TtsRouter
  readonly coordinator: AudioPlaybackCoordinator
  readonly consume: (chunk: TtsAudioChunk, signal: AbortSignal) => Promise<void>
  readonly onProviderError?: (error: TtsProviderError) => void
}

/** Routes a TTS request to PCM playback under the shared Live/manual/autoplay
 *  arbitration lease. Returns false when a higher-priority playback owns the
 *  output. Provider errors remain observable; a terminal error rejects. */
export async function playTtsRequest(
  options: TtsPlaybackOptions,
  request: TtsRequest,
  priority: AudioPlaybackPriority,
): Promise<boolean> {
  const controller = new AbortController()
  const lease = options.coordinator.acquire(priority, () => controller.abort())
  if (!lease) return false

  try {
    for await (const event of options.router.synthesize(request, controller.signal)) {
      if (!options.coordinator.isCurrent(lease) || controller.signal.aborted) return false
      if ("code" in event) {
        options.onProviderError?.(event)
        if (!event.recoverable) throw Object.assign(new Error(event.detail), { code: event.code })
        continue
      }
      await options.consume(event, controller.signal)
      if (!options.coordinator.isCurrent(lease) || controller.signal.aborted) return false
    }
    return !controller.signal.aborted
  } catch (error) {
    if (controller.signal.aborted) return false
    throw error
  } finally {
    options.coordinator.release(lease)
    if (controller.signal.aborted) await options.router.cancel(request.id)
  }
}
