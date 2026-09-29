/* SPDX-License-Identifier: MIT */
/**
 * Plays router PCM chunks through WebAudio, back to back, for read-aloud
 * outside Live. Live writes to the native Oboe output instead; opening Oboe
 * for a manual read would also open the microphone.
 */

import type { TtsAudioChunk } from "@unifia/contracts/tts-router"

export interface PcmPlayer {
  /** Schedules a chunk after the previous one; resolves once scheduled. */
  enqueue(chunk: TtsAudioChunk): void
  /** Resolves when everything scheduled so far has played, or on stop. */
  drain(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  /** Silences and releases the output. Idempotent. */
  stop(): void
  readonly paused: boolean
}

type AudioContextLike = Pick<AudioContext, "currentTime" | "state" | "destination" | "createBuffer" | "createBufferSource" | "suspend" | "resume" | "close">

export function createWebAudioPcmPlayer(context: AudioContextLike = new AudioContext()): PcmPlayer {
  const sources = new Set<AudioBufferSourceNode>()
  let nextStartTime = 0
  let stopped = false
  let paused = false
  let settle: (() => void) | undefined
  let drained = Promise.resolve()

  function settleIfIdle() {
    if (sources.size > 0 && !stopped) return
    settle?.()
    settle = undefined
  }

  return {
    get paused() {
      return paused
    },

    enqueue(chunk) {
      if (stopped || chunk.samples.length === 0 || chunk.sampleRateHz <= 0) return
      const buffer = context.createBuffer(1, chunk.samples.length, chunk.sampleRateHz)
      const channel = buffer.getChannelData(0)
      for (let index = 0; index < chunk.samples.length; index++) channel[index] = chunk.samples[index]! / 32768
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      const startAt = Math.max(context.currentTime, nextStartTime)
      nextStartTime = startAt + buffer.duration
      if (sources.size === 0) drained = new Promise<void>((resolve) => { settle = resolve })
      sources.add(source)
      source.onended = () => {
        sources.delete(source)
        settleIfIdle()
      }
      source.start(startAt)
    },

    drain() {
      return drained
    },

    async pause() {
      if (stopped || paused) return
      paused = true
      await context.suspend()
    },

    async resume() {
      if (stopped || !paused) return
      paused = false
      await context.resume()
    },

    stop() {
      if (stopped) return
      stopped = true
      for (const source of sources) {
        source.onended = null
        try {
          source.stop()
        } catch {
          // Never started or already ended: nothing left to silence.
        }
      }
      sources.clear()
      settleIfIdle()
      void context.close().catch(() => undefined)
    },
  }
}
