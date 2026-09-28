/* SPDX-License-Identifier: MIT */
import type { AudioRoute } from "@unifia/contracts/voice-turn-engine"
import type { VoiceResourceScheduler } from "@unifia/contracts/voice-resource-scheduler"
import { acquireProviderLease, type ProviderLeaseHandle } from "./provider-lease"

export type AudioProcessingProviderKind = "platform-aec" | "webrtc-apm"
export type AudioProcessingMode = AudioProcessingProviderKind | "degraded"
export type AudioProcessingFailure = "capability-missing" | "initialization-failed" | "resource-denied"

export interface AudioProcessingCapability {
  readonly supported: boolean
  readonly echoCancellation: boolean
  readonly noiseSuppression: boolean
  readonly automaticGainControl: boolean
}

/** Platform/runtime adapter contract. This module negotiates and owns
 *  lifecycle only; audio processing remains in a real native adapter. */
export interface AudioProcessingAdapter {
  readonly id: AudioProcessingProviderKind
  capability(route: AudioRoute): Promise<AudioProcessingCapability>
  start(route: AudioRoute): Promise<void>
  stop(): Promise<void>
}

export interface AudioProcessingStatus {
  readonly mode: AudioProcessingMode
  readonly provider?: AudioProcessingProviderKind
  readonly route: AudioRoute
  readonly echoCancellation: boolean
  readonly noiseSuppression: boolean
  readonly automaticGainControl: boolean
  readonly failure?: AudioProcessingFailure
}

export interface AudioProcessingChainOptions {
  readonly scheduler?: VoiceResourceScheduler
  readonly onStatus?: (status: AudioProcessingStatus) => void
}

const REQUIRED_CAPABILITIES: AudioProcessingCapability = {
  supported: true,
  echoCancellation: true,
  noiseSuppression: true,
  automaticGainControl: true,
}

function supportsRequiredChain(capability: AudioProcessingCapability): boolean {
  return (
    capability.supported &&
    capability.echoCancellation &&
    capability.noiseSuppression &&
    capability.automaticGainControl
  )
}

/** Negotiates platform AEC → WebRTC APM → explicit degraded mode.
 *  Route changes tear down the old processing adapter and renegotiate;
 *  no provider or processing quality is inferred when the adapter has
 *  not reported capabilities. This selector does not itself implement
 *  AEC, NS, or AGC, so a missing native adapter remains degraded. */
export function createAudioProcessingChain(
  adapters: readonly AudioProcessingAdapter[],
  options: AudioProcessingChainOptions = {},
) {
  const ordered = ["platform-aec", "webrtc-apm"] as const
  let active: AudioProcessingAdapter | undefined
  let lease: ProviderLeaseHandle | undefined
  let generation = 0
  let disposed = false
  let state: AudioProcessingStatus = {
    mode: "degraded",
    route: "unknown",
    echoCancellation: false,
    noiseSuppression: false,
    automaticGainControl: false,
    failure: "capability-missing",
  }

  function publish(next: AudioProcessingStatus): AudioProcessingStatus {
    state = next
    options.onStatus?.(next)
    return next
  }

  async function releaseActive(): Promise<void> {
    const previous = active
    active = undefined
    try {
      await previous?.stop()
    } finally {
      lease?.dispose()
      lease = undefined
    }
  }

  async function configure(route: AudioRoute): Promise<AudioProcessingStatus> {
    if (disposed) throw new Error("AudioProcessingChain: configure after dispose")
    const current = ++generation
    await releaseActive()

    let failure: AudioProcessingFailure = "capability-missing"
    for (const id of ordered) {
      const adapter = adapters.find((candidate) => candidate.id === id)
      if (!adapter) continue

      let capability: AudioProcessingCapability
      try {
        capability = await adapter.capability(route)
      } catch {
        failure = "capability-missing"
        continue
      }
      if (!supportsRequiredChain(capability)) continue

      let acquired: ProviderLeaseHandle | undefined
      if (options.scheduler) {
        acquired = acquireProviderLease(options.scheduler, {
          resource: { kind: "aec", revision: `${adapter.id}:${route}` },
          owner: "custom",
          priority: "vad-aec",
          residency: "keep-warm",
        })
        if (!acquired) {
          failure = "resource-denied"
          continue
        }
      }

      try {
        await adapter.start(route)
      } catch {
        acquired?.dispose()
        failure = "initialization-failed"
        continue
      }

      if (disposed || current !== generation) {
        try {
          await adapter.stop()
        } finally {
          acquired?.dispose()
        }
        return state
      }

      active = adapter
      lease = acquired
      return publish({
        mode: adapter.id,
        provider: adapter.id,
        route,
        echoCancellation: REQUIRED_CAPABILITIES.echoCancellation,
        noiseSuppression: REQUIRED_CAPABILITIES.noiseSuppression,
        automaticGainControl: REQUIRED_CAPABILITIES.automaticGainControl,
      })
    }

    if (disposed || current !== generation) return state
    return publish({
      mode: "degraded",
      route,
      echoCancellation: false,
      noiseSuppression: false,
      automaticGainControl: false,
      failure,
    })
  }

  return {
    get status(): AudioProcessingStatus {
      return state
    },
    configure,
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      generation++
      await releaseActive()
    },
  }
}
