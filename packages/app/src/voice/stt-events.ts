/* SPDX-License-Identifier: MIT */
/**
 * StreamingSttEvent constructors shared by the streaming STT
 * implementations — one place where the contract event shapes are
 * materialized so the providers cannot drift apart on field defaults
 * (stable flags, sequence clamping, recovered semantics).
 */

import type { SpeechLanguage } from "@unifia/contracts/speech"
import type {
  FinalTranscript,
  PartialHypothesis,
  ProviderError,
} from "@unifia/contracts/streaming-stt"

/** Unstable partial: `stable: false` — text may still be retracted. */
export function part(
  text: string,
  language: SpeechLanguage,
  at: number,
  to: number,
): PartialHypothesis {
  return { kind: "partial", text, stable: false, language, capturedAt: at, lastSequence: to }
}

/** The single FinalTranscript emitted per committed turn. */
export function last(
  text: string,
  language: SpeechLanguage,
  at: number,
  from: number,
  to: number,
): FinalTranscript {
  return {
    kind: "final",
    text,
    language,
    capturedAt: at,
    fromSequence: from < 0 ? 0 : from,
    toSequence: to < 0 ? 0 : to,
  }
}

/** Provider-side mid-stream error; `recovered` marks defects the
 *  provider already worked around (e.g. the empty-final route-around). */
export function fault(
  code: string,
  detail: string,
  at: number,
  recovered = false,
): ProviderError {
  return { kind: "error", code, detail, recovered, capturedAt: at }
}
