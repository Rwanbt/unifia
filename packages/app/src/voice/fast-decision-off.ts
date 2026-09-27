/* SPDX-License-Identifier: MIT */
import type {
  FastDecisionProvider,
  FastDecisionInput,
  DecisionProposal,
  FastDecisionCapabilities,
} from "@unifia/contracts/fast-decision"

/**
 * `off` FastDecision provider — the true bypass.
 *
 * §28: "OFF must be a true bypass: no model loaded; no RAM; no
 * worker; no download." The provider holds zero state, never
 * allocates per call, and never produces a decision other than the
 * safe default `continue`. Use it when:
 *  - the platform policy is `fast-decision = off` (the campaign
 *    production default for LayaExperimental users);
 *  - the FastDecision slot is reserved for a future provider that
 *    has not shipped yet;
 *  - the user explicitly disables FastDecision in diagnostics.
 *
 * Behaviour: every call returns a `continue` proposal with
 * confidence 0, regardless of the input text. The provider does
 * NOT inspect the transcript, does NOT match keywords, and does
 * NOT call any other provider. VoiceCore sees only `continue` and
 * falls back to its own heuristics (continue TTS, continue
 * generation, do not cancel).
 */
export const OFF_FAST_DECISION_PROVIDER_ID = "off" as const

const OFF_CAPABILITIES: FastDecisionCapabilities = {
  providerId: OFF_FAST_DECISION_PROVIDER_ID,
  languages: ["en", "fr", "es", "it", "de"],
  warmLatencyMs: 0,
  peakRssBytes: 0,
  requiresModelDownload: false,
}

export const offFastDecisionProvider: FastDecisionProvider = {
  providerId: OFF_FAST_DECISION_PROVIDER_ID,
  capabilities: OFF_CAPABILITIES,
  decide(input: FastDecisionInput): DecisionProposal {
    return {
      kind: "continue",
      confidence: 0,
      language: input.language,
      sourceText: input.text,
      emittedAt: input.capturedAt,
      rationale: "off-bypass",
    }
  },
}
