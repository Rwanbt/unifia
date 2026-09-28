/* SPDX-License-Identifier: MIT */

export interface TurnEndpointingOptions {
  speechThreshold: number
  minimumSpeechMs: number
  trailingSilenceMs: number
  maximumUtteranceMs: number
}

export type TurnEndpointingEvent =
  | { type: "speech-started" }
  | { type: "utterance-finalized"; durationMs: number; reason: "silence" | "maximum-duration" }

export const DEFAULT_TURN_ENDPOINTING_OPTIONS: TurnEndpointingOptions = {
  speechThreshold: 0.5,
  minimumSpeechMs: 280,
  trailingSilenceMs: 650,
  maximumUtteranceMs: 60_000,
}

/** Converts frame-level local VAD scores into bounded, finalized speech turns. */
export class TurnEndpointing {
  private active = false
  private speechMs = 0
  private silenceMs = 0

  constructor(private readonly options: TurnEndpointingOptions = DEFAULT_TURN_ENDPOINTING_OPTIONS) {
    if (!(options.speechThreshold >= 0 && options.speechThreshold <= 1)) {
      throw new RangeError("speechThreshold must be between 0 and 1")
    }
    if (options.minimumSpeechMs <= 0 || options.trailingSilenceMs <= 0 || options.maximumUtteranceMs <= options.minimumSpeechMs) {
      throw new RangeError("turn durations must be positive and maximumUtteranceMs must exceed minimumSpeechMs")
    }
  }

  get isSpeechActive(): boolean {
    return this.active
  }

  accept(probability: number, frameDurationMs: number): TurnEndpointingEvent[] {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError("VAD probability must be between 0 and 1")
    }
    if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
      throw new RangeError("frameDurationMs must be positive")
    }

    const events: TurnEndpointingEvent[] = []
    if (probability >= this.options.speechThreshold) {
      if (!this.active) {
        this.active = true
        this.speechMs = 0
        this.silenceMs = 0
        events.push({ type: "speech-started" })
      }
      this.speechMs += frameDurationMs
      this.silenceMs = 0
      if (this.speechMs >= this.options.maximumUtteranceMs) {
        events.push(this.finalize("maximum-duration"))
      }
      return events
    }

    if (!this.active) return events
    this.silenceMs += frameDurationMs
    if (this.silenceMs < this.options.trailingSilenceMs) return events
    if (this.speechMs >= this.options.minimumSpeechMs) events.push(this.finalize("silence"))
    else this.reset()
    return events
  }

  reset(): void {
    this.active = false
    this.speechMs = 0
    this.silenceMs = 0
  }

  private finalize(reason: "silence" | "maximum-duration"): TurnEndpointingEvent {
    const durationMs = this.speechMs
    this.reset()
    return { type: "utterance-finalized", durationMs, reason }
  }
}
