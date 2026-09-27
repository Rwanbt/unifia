/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { offFastDecisionProvider, OFF_FAST_DECISION_PROVIDER_ID } from "./fast-decision-off"

describe("offFastDecisionProvider", () => {
  it("uses the `off` provider id", () => {
    expect(offFastDecisionProvider.providerId).toBe(OFF_FAST_DECISION_PROVIDER_ID)
    expect(offFastDecisionProvider.providerId).toBe("off")
  })

  it("advertises zero load (§28 true bypass)", () => {
    const cap = offFastDecisionProvider.capabilities
    expect(cap.warmLatencyMs).toBe(0)
    expect(cap.peakRssBytes).toBe(0)
    expect(cap.requiresModelDownload).toBe(false)
  })

  it("covers all five required languages", () => {
    expect(offFastDecisionProvider.capabilities.languages).toEqual([
      "en",
      "fr",
      "es",
      "it",
      "de",
    ])
  })

  it("returns `continue` for any input — including adversarial text", () => {
    const adversarial = [
      "stop",
      "cancel",
      "shh",
      "no wait",
      "yes",
      "no",
      "abort",
      "annule",
      "cancela",
      "silencio",
      "zitto",
      "stopp",
      "...",
      "",
      "     ",
      "🎙️",
    ]
    for (const text of adversarial) {
      const proposal = offFastDecisionProvider.decide({
        text,
        language: "en",
        stage: "final",
        capturedAt: 1,
      })
      expect(proposal.kind).toBe("continue")
      expect(proposal.confidence).toBe(0)
      expect(proposal.emittedAt).toBe(1)
      expect(proposal.rationale).toBe("off-bypass")
    }
  })

  it("propagates the input language into the proposal", () => {
    const proposal = offFastDecisionProvider.decide({
      text: "stop",
      language: "fr",
      stage: "partial",
      capturedAt: 42,
    })
    expect(proposal.language).toBe("fr")
    expect(proposal.sourceText).toBe("stop")
    expect(proposal.emittedAt).toBe(42)
  })

  it("never mutates the input", () => {
    const input = {
      text: "hello",
      language: "en" as const,
      stage: "final" as const,
      capturedAt: 7,
    }
    const snapshot = JSON.stringify(input)
    offFastDecisionProvider.decide(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
