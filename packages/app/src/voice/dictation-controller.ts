/* SPDX-License-Identifier: MIT */

/**
 * Dictation orchestration shared by every shell.
 *
 * The desktop, mobile and web shells each own a different capture engine: a
 * MediaRecorder sent to the native recogniser, a streaming native session, and
 * the browser speech API. What they share is the lifecycle: one session at a
 * time, a start that can fail, a finish that may produce text, a cancel that
 * must not, and an automatic stop decided by the engine.
 *
 * The controller owns that lifecycle and nothing else. Engines stay replaceable
 * behind `DictationEngine`; the shells only wire callbacks.
 */

export type DictationState = "idle" | "starting" | "recording" | "finishing"

export interface DictationEngine {
  /** Resolves once capture is actually running. */
  start(): Promise<void>
  /** Stops capture and resolves with the final transcript, empty when nothing was heard. */
  finish(): Promise<string>
  /** Aborts capture; a pending finish resolves with an empty string. */
  cancel(): Promise<void>
  /** Optional provisional transcript while recording. */
  onPartial?(listener: (text: string) => void): () => void
  /** Optional microphone level in `0..1`. */
  onLevel?(listener: (level: number) => void): () => void
  /** Optional engine-decided end of speech (silence, one-minute cap). */
  onAutoStop?(listener: () => void): () => void
}

export interface DictationControllerOptions {
  engine: DictationEngine
  /** Called with a non-empty trimmed transcript. */
  onText(text: string): void
  onError(error: unknown): void
  onState?(state: DictationState): void
  onPartial?(text: string): void
  onLevel?(level: number): void
}

export class DictationController {
  private current: DictationState = "idle"
  private unsubscribers: (() => void)[] = []
  /** A cancel arrived while the engine was still starting. */
  private cancelDuringStart = false

  constructor(private options: DictationControllerOptions) {
    const { engine } = options
    if (engine.onAutoStop) this.unsubscribers.push(engine.onAutoStop(() => void this.handleAutoStop()))
    if (engine.onPartial && options.onPartial) {
      const forward = options.onPartial
      this.unsubscribers.push(engine.onPartial((text) => forward(text)))
    }
    if (engine.onLevel && options.onLevel) {
      const forward = options.onLevel
      this.unsubscribers.push(engine.onLevel((level) => forward(level)))
    }
  }

  get state(): DictationState {
    return this.current
  }

  /** Starts a session unless one is already running or finishing. */
  async start(): Promise<void> {
    if (this.current !== "idle") return
    this.cancelDuringStart = false
    this.setState("starting")
    try {
      await this.options.engine.start()
      if (this.cancelDuringStart) {
        this.cancelDuringStart = false
        return
      }
      this.setState("recording")
    } catch (error) {
      this.cancelDuringStart = false
      this.setState("idle")
      this.options.onError(error)
    }
  }

  /** Finishes the running session and delivers its transcript. */
  async finish(): Promise<void> {
    // A stop during the start has nothing to transcribe yet: the microphone is
    // still being acquired, so the session is abandoned and the late stream is
    // closed by the engine instead of opening a recorder for nobody.
    if (this.current === "starting") return this.cancel()
    if (this.current !== "recording") return
    this.setState("finishing")
    try {
      const text = await this.options.engine.finish()
      this.setState("idle")
      const trimmed = text.trim()
      if (trimmed) this.options.onText(trimmed)
    } catch (error) {
      this.setState("idle")
      this.options.onError(error)
    }
  }

  /** Abandons the running session; no transcript is delivered. */
  async cancel(): Promise<void> {
    if (this.current === "starting") this.cancelDuringStart = true
    if (this.current === "idle") return
    try {
      await this.options.engine.cancel()
    } catch (error) {
      this.options.onError(error)
    }
    this.setState("idle")
  }

  /** Microphone button behaviour: start when idle, finish when recording. */
  async toggle(): Promise<void> {
    if (this.current === "recording") return this.finish()
    return this.start()
  }

  /** Called by the engine when it decides the utterance ended. */
  async handleAutoStop(): Promise<void> {
    return this.finish()
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
  }

  private setState(state: DictationState): void {
    this.current = state
    this.options.onState?.(state)
  }
}
