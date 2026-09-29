/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import type {
  FastDecisionProvider,
  FastDecisionProviderId,
  FastDecisionKind,
  FastDecisionInput,
  DecisionProposal,
  FastDecisionCapabilities,
} from "../src/index.js"

/**
 * FastDecision contract tests (§28).
 *
 * Type-level + capability-shape tests. The behavioural assertions
 * live with the implementations (`packages/app/src/voice/fast-decision-*.test.ts`).
 */

describe("FastDecision contract", () => {
  it("exports a closed set of provider ids", () => {
    const ids: FastDecisionProviderId[] = [
      "off",
      "rules",
      "tiny-classifier",
      "laya",
      "custom",
    ]
    expect(ids.length).toBe(5)
  })

  it("exports a closed set of decision kinds (no `unknown`)", () => {
    const kinds: FastDecisionKind[] = [
      "continue",
      "cancel-speech",
      "cancel-task",
      "correction",
      "new-request",
      "acknowledgement",
      "permission-answer",
      "noise",
    ]
    expect(kinds.length).toBe(8)
    expect(kinds).not.toContain("unknown")
  })

  it("DecisionProposal is read-only and timestamped", () => {
    const proposal: DecisionProposal = {
      kind: "continue",
      confidence: 0,
      language: "en",
      sourceText: "",
      emittedAt: 0,
    }
    expect(proposal.kind).toBe("continue")
    expect(typeof proposal.emittedAt).toBe("number")
  })

  it("FastDecisionCapabilities for `off` must report zero load", () => {
    const offCaps: FastDecisionCapabilities = {
      providerId: "off",
      languages: ["en", "fr", "es", "it", "de"],
      warmLatencyMs: 0,
      peakRssBytes: 0,
      requiresModelDownload: false,
    }
    expect(offCaps.warmLatencyMs).toBe(0)
    expect(offCaps.peakRssBytes).toBe(0)
    expect(offCaps.requiresModelDownload).toBe(false)
  })

  it("FastDecisionProvider exposes a pure `decide` function", () => {
    const stub: FastDecisionProvider = {
      providerId: "off",
      capabilities: {
        providerId: "off",
        languages: ["en"],
        warmLatencyMs: 0,
        peakRssBytes: 0,
        requiresModelDownload: false,
      },
      decide(input: FastDecisionInput): DecisionProposal {
        return {
          kind: "continue",
          confidence: 0,
          language: input.language,
          sourceText: input.text,
          emittedAt: input.capturedAt,
          rationale: "stub",
        }
      },
    }
    const proposal = stub.decide({
      text: "hello",
      language: "en",
      stage: "final",
      capturedAt: 1,
    })
    expect(proposal.kind).toBe("continue")
    expect(proposal.sourceText).toBe("hello")
  })
})
