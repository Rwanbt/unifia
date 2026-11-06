/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { DictationEngine } from "./dictation-controller"
import { withCaptureLease } from "./leased-engine"

class FakeEngine implements DictationEngine {
  started = 0
  finished = 0
  cancelled = 0
  transcript = "bonjour"
  startError: unknown
  private autoStop: (() => void) | undefined

  async start(): Promise<void> {
    this.started += 1
    if (this.startError) throw this.startError
  }

  async finish(): Promise<string> {
    this.finished += 1
    return this.transcript
  }

  async cancel(): Promise<void> {
    this.cancelled += 1
  }

  onAutoStop(listener: () => void): () => void {
    this.autoStop = listener
    return () => {
      this.autoStop = undefined
    }
  }

  triggerAutoStop(): void {
    this.autoStop?.()
  }
}

function setup(options: { grant?: boolean; startError?: unknown } = {}) {
  const engine = new FakeEngine()
  engine.startError = options.startError
  const releases: number[] = []
  let refused = 0
  const leased = withCaptureLease(engine, {
    acquire: () => (options.grant === false ? undefined : { release: () => releases.push(1) }),
    onRefused: () => {
      refused += 1
    },
  })
  return { engine, leased, releases, refused: () => refused }
}

describe("leased engine", () => {
  test("start acquires the lease and starts the engine", async () => {
    const { engine, leased, releases } = setup()
    await leased.start()
    expect(engine.started).toBe(1)
    expect(releases).toEqual([])
  })

  test("finish releases the lease", async () => {
    const { engine, leased, releases } = setup()
    await leased.start()
    expect(await leased.finish()).toBe("bonjour")
    expect(engine.finished).toBe(1)
    expect(releases).toEqual([1])
  })

  test("cancel releases the lease", async () => {
    const { engine, leased, releases } = setup()
    await leased.start()
    await leased.cancel()
    expect(engine.cancelled).toBe(1)
    expect(releases).toEqual([1])
  })

  test("a refused lease reports the refusal and never starts the engine", async () => {
    const { engine, leased, refused } = setup({ grant: false })
    await expect(leased.start()).rejects.toThrow("microphone capture unavailable")
    expect(refused()).toBe(1)
    expect(engine.started).toBe(0)
  })

  test("an engine start failure releases the lease", async () => {
    const { leased, releases } = setup({ startError: new Error("native session busy") })
    await expect(leased.start()).rejects.toThrow("native session busy")
    expect(releases).toEqual([1])
  })

  test("engine streams are forwarded", async () => {
    const { engine, leased } = setup()
    let stops = 0
    leased.onAutoStop!(() => {
      stops += 1
    })
    engine.triggerAutoStop()
    expect(stops).toBe(1)
  })
})
