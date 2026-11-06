/* SPDX-License-Identifier: MIT */

import type { DictationEngine } from "./dictation-controller"

/**
 * Wraps an engine with the microphone lease the capture coordinator hands out.
 *
 * The shared controller knows nothing about microphone ownership: the shell
 * decides who may capture. The media recorder engine acquires its own lease
 * because recording and ownership are the same act there; a streaming engine
 * (the native session) does not, so the shell decorates it instead of
 * duplicating lease handling in the shell.
 *
 * The lease is released on finish, on cancel and when start fails — never left
 * held by a session that ended.
 */

export interface CaptureLease {
  release(): void
}

export interface LeasedEngineOptions {
  /** Returns the lease, or undefined when another owner holds the microphone. */
  acquire(): CaptureLease | undefined
  /** Called when the microphone is held elsewhere, before start rejects. */
  onRefused?(): void
}

export function withCaptureLease(engine: DictationEngine, options: LeasedEngineOptions): DictationEngine {
  let lease: CaptureLease | undefined

  const release = () => {
    lease?.release()
    lease = undefined
  }

  return {
    async start() {
      const acquired = options.acquire()
      if (!acquired) {
        options.onRefused?.()
        throw new Error("microphone capture unavailable")
      }
      lease = acquired
      try {
        await engine.start()
      } catch (error) {
        release()
        throw error
      }
    },

    async finish() {
      try {
        return await engine.finish()
      } finally {
        release()
      }
    },

    async cancel() {
      try {
        await engine.cancel()
      } finally {
        release()
      }
    },

    onPartial: engine.onPartial?.bind(engine),
    onLevel: engine.onLevel?.bind(engine),
    onAutoStop: engine.onAutoStop?.bind(engine),
  }
}
