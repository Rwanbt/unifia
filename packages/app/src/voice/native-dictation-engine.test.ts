/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { NativeDictation } from "../hooks/native-dictation"
import { createNativeDictationEngine } from "./native-dictation-engine"

class FakeNativeDictation implements NativeDictation {
  started = 0
  finished = 0
  transcript = "salut"
  partials: ((text: string) => void)[] = []
  levels: ((level: number) => void)[] = []
  autoStops: (() => void)[] = []

  async start(): Promise<void> {
    this.started += 1
  }

  async finish(): Promise<string> {
    this.finished += 1
    return this.transcript
  }

  onFull(_listener: () => void): () => void {
    return () => {}
  }

  onPartial(listener: (text: string) => void): () => void {
    this.partials.push(listener)
    return () => {
      this.partials = this.partials.filter((entry) => entry !== listener)
    }
  }

  onLevel(listener: (level: number) => void): () => void {
    this.levels.push(listener)
    return () => {
      this.levels = this.levels.filter((entry) => entry !== listener)
    }
  }

  onAutoStop(listener: () => void): () => void {
    this.autoStops.push(listener)
    return () => {
      this.autoStops = this.autoStops.filter((entry) => entry !== listener)
    }
  }
}

describe("native dictation engine", () => {
  test("start and finish delegate to the native session", async () => {
    const native = new FakeNativeDictation()
    const engine = createNativeDictationEngine(native)

    await engine.start()
    expect(native.started).toBe(1)
    expect(await engine.finish()).toBe("salut")
    expect(native.finished).toBe(1)
  })

  test("cancel closes the native session without exposing its text", async () => {
    const native = new FakeNativeDictation()
    const engine = createNativeDictationEngine(native)

    await engine.cancel()
    expect(native.finished).toBe(1)
  })

  test("partials, levels and auto-stop are forwarded and can be removed", () => {
    const native = new FakeNativeDictation()
    const engine = createNativeDictationEngine(native)
    const partials: string[] = []
    const levels: number[] = []
    let stops = 0

    const offPartial = engine.onPartial!((text) => partials.push(text))
    const offLevel = engine.onLevel!((level) => levels.push(level))
    const offStop = engine.onAutoStop!(() => {
      stops += 1
    })

    native.partials[0]("bon")
    native.levels[0](0.5)
    native.autoStops[0]()
    expect(partials).toEqual(["bon"])
    expect(levels).toEqual([0.5])
    expect(stops).toBe(1)

    offPartial()
    offLevel()
    offStop()
    expect(native.partials).toHaveLength(0)
    expect(native.levels).toHaveLength(0)
    expect(native.autoStops).toHaveLength(0)
  })
})
