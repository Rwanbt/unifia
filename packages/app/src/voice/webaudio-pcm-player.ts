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

/**
 * Lead given to the first chunk after the queue ran dry. Pocket streams
 * ~80 ms chunks; starting on the first one left 30 ms of margin and a 234 ms
 * gap one chunk later on a Mi 10 Pro. A short pre-roll absorbs that jitter.
 */
export const PREROLL_SECONDS = 0.3

type AudioContextLike = Pick<AudioContext, "currentTime" | "state" | "destination" | "createBuffer" | "createBufferSource" | "suspend" | "resume" | "close">

/** DIAG: per-chunk scheduling report; gapMs > 0 means the queue ran dry. */
export type PcmScheduleReport = (report: { gapMs: number; leadMs: number; chunkMs: number }) => void

export function createWebAudioPcmPlayer(
  context: AudioContextLike = new AudioContext(),
  onSchedule?: PcmScheduleReport,
): PcmPlayer {
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
      const gapMs = nextStartTime > 0 && context.currentTime > nextStartTime ? (context.currentTime - nextStartTime) * 1000 : 0
      const idle = nextStartTime <= context.currentTime
      const startAt = idle ? context.currentTime + PREROLL_SECONDS : nextStartTime
      nextStartTime = startAt + buffer.duration
      onSchedule?.({ gapMs, leadMs: (nextStartTime - context.currentTime) * 1000, chunkMs: buffer.duration * 1000 })
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
