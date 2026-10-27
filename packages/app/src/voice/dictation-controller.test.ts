/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { DictationController, type DictationEngine, type DictationState } from "./dictation-controller"

class FakeEngine implements DictationEngine {
  started = 0
  finished = 0
  cancelled = 0
  transcript = "bonjour"
  startError: unknown
  finishError: unknown
  cancelError: unknown
  /** Lets a test hold the start open, as a real microphone acquisition does. */
  startGate: Promise<void> | undefined
  private autoStopListener: (() => void) | undefined

  async start(): Promise<void> {
    this.started += 1
    if (this.startGate) await this.startGate
    if (this.startError) throw this.startError
  }

  async finish(): Promise<string> {
    this.finished += 1
    if (this.finishError) throw this.finishError
    return this.transcript
  }

  async cancel(): Promise<void> {
    this.cancelled += 1
    if (this.cancelError) throw this.cancelError
  }

  onAutoStop(listener: () => void): () => void {
    this.autoStopListener = listener
    return () => {
      this.autoStopListener = undefined
    }
  }

  triggerAutoStop(): void {
    this.autoStopListener?.()
  }

  get subscribed(): boolean {
    return this.autoStopListener !== undefined
  }
}

function setup() {
  const engine = new FakeEngine()
  const texts: string[] = []
  const errors: unknown[] = []
  const states: DictationState[] = []
  const controller = new DictationController({
    engine,
    onText: (text) => texts.push(text),
    onError: (error) => errors.push(error),
    onState: (state) => states.push(state),
  })
  return { engine, controller, texts, errors, states }
}

describe("dictation controller", () => {
  test("records then delivers the transcript", async () => {
    const { engine, controller, texts, states } = setup()

    await controller.start()
    expect(controller.state).toBe("recording")
    expect(engine.started).toBe(1)

    await controller.finish()
    expect(controller.state).toBe("idle")
    expect(texts).toEqual(["bonjour"])
    expect(states).toEqual(["starting", "recording", "finishing", "idle"])
  })

  test("a second start is ignored while a session runs", async () => {
    const { engine, controller } = setup()
    await controller.start()
    await controller.start()
    expect(engine.started).toBe(1)
  })

  test("a stop requested while starting abandons the start without a transcript", async () => {
    const { engine, controller, texts, states } = setup()
    let releaseStart!: () => void
    engine.startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })

    const starting = controller.start()
    expect(controller.state).toBe("starting")

    await controller.finish()
    expect(engine.cancelled).toBe(1)
    expect(controller.state).toBe("idle")

    releaseStart()
    await starting
    expect(engine.finished).toBe(0)
    expect(texts).toEqual([])
    expect(states).toEqual(["starting", "idle"])
  })

  test("a cancel requested while starting cancels the engine at once", async () => {
    const { engine, controller, texts, states } = setup()
    let releaseStart!: () => void
    engine.startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })

    const starting = controller.start()
    await controller.cancel()
    expect(engine.cancelled).toBe(1)

    releaseStart()
    await starting
    expect(engine.started).toBe(1)
    expect(texts).toEqual([])
    expect(states).toEqual(["starting", "idle"])
  })

  test("a failed start keeps the session idle after a stop", async () => {
    const { engine, controller, errors } = setup()
    let releaseStart!: () => void
    engine.startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    engine.startError = new Error("micro refusé")

    const starting = controller.start()
    await controller.finish()
    releaseStart()
    await starting

    expect(engine.finished).toBe(0)
    expect(controller.state).toBe("idle")
    expect(errors).toHaveLength(1)
  })

  test("a failed start reports the error and returns to idle", async () => {
    const { engine, controller, errors } = setup()
    engine.startError = new Error("micro refusé")

    await controller.start()
    expect(controller.state).toBe("idle")
    expect(errors).toHaveLength(1)
  })

  test("finish without a running session does nothing", async () => {
    const { engine, controller, texts } = setup()
    await controller.finish()
    expect(engine.finished).toBe(0)
    expect(texts).toEqual([])
  })

  test("a failed finish reports the error and returns to idle", async () => {
    const { engine, controller, errors } = setup()
    engine.finishError = new Error("transcription échouée")
    await controller.start()

    await controller.finish()
    expect(controller.state).toBe("idle")
    expect(errors).toHaveLength(1)
  })

  test("an empty transcript is not delivered", async () => {
    const { engine, controller, texts } = setup()
    engine.transcript = "   "
    await controller.start()

    await controller.finish()
    expect(texts).toEqual([])
  })

  test("cancel abandons the session without text", async () => {
    const { engine, controller, texts } = setup()
    await controller.start()

    await controller.cancel()
    expect(engine.cancelled).toBe(1)
    expect(controller.state).toBe("idle")
    expect(texts).toEqual([])
  })

  test("toggle starts then finishes", async () => {
    const { engine, controller, texts } = setup()

    await controller.toggle()
    expect(controller.state).toBe("recording")
    await controller.toggle()
    expect(engine.finished).toBe(1)
    expect(texts).toEqual(["bonjour"])
  })

  test("an engine-decided stop finishes the session", async () => {
    const { engine, controller, texts } = setup()
    await controller.start()

    await controller.handleAutoStop()
    expect(texts).toEqual(["bonjour"])
    expect(controller.state).toBe("idle")
  })

  test("dispose unsubscribes from the engine", async () => {
    const { engine, controller } = setup()
    expect(engine.subscribed).toBe(true)
    controller.dispose()
    expect(engine.subscribed).toBe(false)
  })
})
