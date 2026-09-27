/* SPDX-License-Identifier: MIT */
/**
 * FastDecisionProvider — pre-LLM intent classification (§28).
 *
 * The Live voice path produces partial transcripts and final
 * transcripts faster than the LLM can respond. FastDecision is the
 * narrow classifier that runs *after* STT and *before* the LLM
 * round-trip, so the assistant can decide whether to interrupt
 * itself, cancel its own task, ignore noise, or wait for the user
 * to finish.
 *
 * Hard rule (§2): FastDecision only PROPOSES. It cannot call tools,
 * accept permissions, touch files, or cancel privileged work. The
 * canonical Unifia session remains the sole authority over LLM
 * selection, tools, secrets, and permissions. FastDecision is
 * advisory: its `DecisionProposal` is read by VoiceCore, which
 * decides what to do (mute TTS, drop the partial, forward to
 * Unifia, etc.).
 *
 * Provider modes (§28):
 *  - "off"              — true bypass, no model loaded, no RAM,
 *                         no worker, no download, every input is
 *                         `continue`
 *  - "rules"            — production default: keyword/regex
 *                         classifier with no model download
 *  - "tiny-classifier"  — small INT8 neural classifier (future)
 *  - "laya"             — experimental Laya base model (out of
 *                         scope for v2.2 per §28)
 *  - "custom"           — host-provided implementation
 */

import type { SpeechLanguage } from "./speech.js"

/** Provider identifier — used by the model registry to resolve the
 *  concrete provider instance. The `"rules-fast-decision"`
 *  ProviderId in `voice-resource-scheduler.ts` is the canonical
 *  Rules provider. */
export type FastDecisionProviderId =
  | "off"
  | "rules"
  | "tiny-classifier"
  | "laya"
  | "custom"

/** The decision categories FastDecision can emit. The set is
 *  exhaustive: anything that does not match a known intent MUST be
 *  classified as `continue` (the safe default) rather than `unknown`,
 *  per §13. */
export type FastDecisionKind =
  /** Assistant should keep doing what it is doing (default). */
  | "continue"
  /** "Stop talking" / "be quiet" / "shh" — cancel the active TTS
   *  generation but do not cancel the LLM task itself. */
  | "cancel-speech"
  /** "Stop everything" / "never mind" / "cancel" — cancel both
   *  TTS and the active LLM task. Forwarded to Unifia authority,
   *  which decides whether the user actually has the right to
   *  cancel this task. */
  | "cancel-task"
  /** "I meant X, not Y" — the assistant is mid-sentence; ignore
   *  what was just said and treat the next partial as a correction. */
  | "correction"
  /** A brand-new request that supersedes anything already in flight. */
  | "new-request"
  /** "ok" / "yes" / "no" / "sure" — short acknowledgement,
   *  possibly an answer to a pending permission question. */
  | "acknowledgement"
  /** A direct answer to a previously-asked permission request. */
  | "permission-answer"
  /** Filler / breath / non-speech — drop the partial. */
  | "noise"

/** Confidence in [0, 1]. Rules emits `1.0` for matched keywords
 *  and `0.0` for the default `continue`. Neural providers emit a
 *  calibrated probability. Consumers may threshold. */
export interface DecisionProposal {
  readonly kind: FastDecisionKind
  readonly confidence: number
  readonly language: SpeechLanguage
  /** The text the proposal was derived from. Scrubbed of secrets
   *  before reaching this struct. */
  readonly sourceText: string
  /** Monotonic timestamp (ms) when the proposal was emitted. */
  readonly emittedAt: number
  /** Optional human-readable rationale — for Rules this is the
   *  matched pattern id; for neural providers this may be empty. */
  readonly rationale?: string
}

/** Capabilities the provider advertises at startup. The router uses
 *  them to choose a provider per language + per-host. */
export interface FastDecisionCapabilities {
  readonly providerId: FastDecisionProviderId
  readonly languages: readonly SpeechLanguage[]
  /** Estimated warm latency in milliseconds for a single decision.
   *  `0` for `off`. */
  readonly warmLatencyMs: number
  /** Approximate peak RSS the provider consumes. `0` for `off`
   *  (true bypass — no memory held). */
  readonly peakRssBytes: number
  /** Whether the provider requires a model download. `false` for
   *  `off` and `rules`. */
  readonly requiresModelDownload: boolean
}

/** Configuration passed to the provider at acquisition. */
export interface FastDecisionConfig {
  readonly language: SpeechLanguage
  /** Optional list of permission-request ids the provider may
   *  match against for `permission-answer`. */
  readonly pendingPermissionIds?: readonly string[]
}

/** FastDecision providers are pure-ish: they take a transcript
 *  (partial or final) and return a proposal synchronously. There
 *  is no streaming, no model warm-up, no audio thread. */
export interface FastDecisionProvider {
  readonly providerId: FastDecisionProviderId
  readonly capabilities: FastDecisionCapabilities
  /** Decide the intent of a transcript. Pure function over the
   *  inputs; safe to call from any thread; never throws on
   *  invalid input (returns a `continue` proposal with
   *  `confidence: 0`). */
  decide(input: FastDecisionInput): DecisionProposal
}

/** The input the consumer hands to the provider. The provider
 *  MUST NOT mutate it. */
export interface FastDecisionInput {
  readonly text: string
  readonly language: SpeechLanguage
  /** Whether this text is a partial (still changing) or a final
   *  transcript. Rules treats final the same as partial; neural
   *  providers may weight them differently. */
  readonly stage: "partial" | "final"
  readonly capturedAt: number
  /** Optional context: the last assistant utterance, for
   *  correction / acknowledgement matching. */
  readonly lastAssistantText?: string
  /** Optional context: pending permission ids, for
   *  permission-answer matching. */
  readonly pendingPermissionIds?: readonly string[]
}
