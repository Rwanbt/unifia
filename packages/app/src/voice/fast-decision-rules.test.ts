/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { rulesFastDecisionProvider, RULES_FAST_DECISION_PROVIDER_ID } from "./fast-decision-rules"

const decide = (text: string, language: "en" | "fr" | "es" | "it" | "de" = "en") =>
  rulesFastDecisionProvider.decide({
    text,
    language,
    stage: "final",
    capturedAt: 1,
  })

describe("rulesFastDecisionProvider", () => {
  it("uses the `rules` provider id", () => {
    expect(rulesFastDecisionProvider.providerId).toBe(RULES_FAST_DECISION_PROVIDER_ID)
    expect(rulesFastDecisionProvider.providerId).toBe("rules")
  })

  it("advertises zero load (no model, no RAM, no download)", () => {
    const cap = rulesFastDecisionProvider.capabilities
    expect(cap.warmLatencyMs).toBe(0)
    expect(cap.peakRssBytes).toBe(0)
    expect(cap.requiresModelDownload).toBe(false)
  })

  it("covers all five required languages", () => {
    expect(rulesFastDecisionProvider.capabilities.languages).toEqual([
      "en",
      "fr",
      "es",
      "it",
      "de",
    ])
  })

  it("defaults to `continue` for unmatched text", () => {
    const proposal = decide("Please refactor the auth module.")
    expect(proposal.kind).toBe("continue")
    expect(proposal.confidence).toBe(0)
    expect(proposal.rationale).toBe("rules-default-continue")
  })

  it("classifies cancel-task EN/FR/ES/IT/DE", () => {
    expect(decide("stop").kind).toBe("cancel-task")
    expect(decide("cancel that").kind).toBe("cancel-task")
    expect(decide("never mind").kind).toBe("cancel-task")
    expect(decide("annule ça", "fr").kind).toBe("cancel-task")
    expect(decide("laisse tomber", "fr").kind).toBe("cancel-task")
    expect(decide("cancela eso", "es").kind).toBe("cancel-task")
    expect(decide("olvídalo", "es").kind).toBe("cancel-task")
    expect(decide("annulla tutto", "it").kind).toBe("cancel-task")
    expect(decide("lascia perdere", "it").kind).toBe("cancel-task")
    expect(decide("abbrechen", "de").kind).toBe("cancel-task")
    expect(decide("vergiss es", "de").kind).toBe("cancel-task")
  })

  it("classifies cancel-speech distinct from cancel-task", () => {
    expect(decide("shh").kind).toBe("cancel-speech")
    expect(decide("be quiet").kind).toBe("cancel-speech")
    expect(decide("stop talking").kind).toBe("cancel-speech")
    expect(decide("chut", "fr").kind).toBe("cancel-speech")
    expect(decide("silence", "fr").kind).toBe("cancel-speech")
    expect(decide("silencio", "es").kind).toBe("cancel-speech")
    expect(decide("zitto", "it").kind).toBe("cancel-speech")
    expect(decide("psst", "de").kind).toBe("cancel-speech")
    expect(decide("halt die klappe", "de").kind).toBe("cancel-speech")
  })

  it("classifies correction EN/FR/ES/IT/DE", () => {
    expect(decide("actually, I meant Linux").kind).toBe("correction")
    expect(decide("no wait, that's wrong").kind).toBe("correction")
    expect(decide("let me rephrase").kind).toBe("correction")
    expect(decide("je voulais dire macOS", "fr").kind).toBe("correction")
    expect(decide("en realidad quería decir 42", "es").kind).toBe("correction")
    expect(decide("intendevo dire 42", "it").kind).toBe("correction")
    expect(decide("ich meinte eigentlich Windows", "de").kind).toBe("correction")
  })

  it("classifies explicit new-request topic transitions in EN/FR/ES/IT/DE", () => {
    expect(decide("I have a new request").kind).toBe("new-request")
    expect(decide("different question: what is the weather?").kind).toBe("new-request")
    expect(decide("une autre question", "fr").kind).toBe("new-request")
    expect(decide("cambiemos de tema", "es").kind).toBe("new-request")
    expect(decide("un'altra domanda", "it").kind).toBe("new-request")
    expect(decide("neues Thema", "de").kind).toBe("new-request")
  })

  it("does not infer new-request for ordinary content", () => {
    expect(decide("Please summarize this document").kind).toBe("continue")
    expect(decide("Open the settings panel").kind).toBe("continue")
  })

  it("classifies permission-answer yes/no across languages", () => {
    expect(decide("yes").kind).toBe("permission-answer")
    expect(decide("no").kind).toBe("permission-answer")
    expect(decide("sure").kind).toBe("permission-answer")
    expect(decide("approve").kind).toBe("permission-answer")
    expect(decide("oui", "fr").kind).toBe("permission-answer")
    expect(decide("non", "fr").kind).toBe("permission-answer")
    expect(decide("sí", "es").kind).toBe("permission-answer")
    expect(decide("sì", "it").kind).toBe("permission-answer")
    expect(decide("ja", "de").kind).toBe("permission-answer")
    expect(decide("nein", "de").kind).toBe("permission-answer")
  })

  it("classifies acknowledgement EN/FR/ES/IT/DE", () => {
    expect(decide("got it").kind).toBe("acknowledgement")
    expect(decide("makes sense").kind).toBe("acknowledgement")
    expect(decide("d'accord", "fr").kind).toBe("acknowledgement")
    expect(decide("entendido", "es").kind).toBe("acknowledgement")
    expect(decide("ho capito", "it").kind).toBe("acknowledgement")
    expect(decide("verstanden", "de").kind).toBe("acknowledgement")
  })

  it("does not leak across languages (German `okay` does not match EN `ok`)", () => {
    // Regression test: pre-language-scoped rules caught English
    // "ok" via the German permission-answer pattern. With
    // language scoping, only the EN pattern list fires for EN input.
    expect(decide("ok").kind).toBe("continue")
    expect(decide("okay", "de").kind).toBe("permission-answer")
  })

  it("classifies empty / punctuation-only as noise", () => {
    expect(decide("").kind).toBe("noise")
    expect(decide("   ").kind).toBe("noise")
    expect(decide("...").kind).toBe("noise")
    expect(decide("…").kind).toBe("noise")
  })

  it("emits confidence 1 on a match", () => {
    const proposal = decide("stop")
    expect(proposal.confidence).toBe(1)
  })

  it("priority: cancel-task beats cancel-speech (source order)", () => {
    // "stop" is unambiguously cancel-task; verify it does NOT
    // collide with cancel-speech patterns even when "stop talking"
    // appears in the same text.
    expect(decide("stop everything").kind).toBe("cancel-task")
    expect(decide("arrête de parler", "fr").kind).toBe("cancel-speech")
  })

  it("priority: permission-answer beats acknowledgement for short yes/no", () => {
    // "yes" is permission-answer (not acknowledgement) because
    // short yes/no to a pending permission is the more useful
    // interpretation. VoiceCore falls back to acknowledgement if
    // there is no pending permission.
    expect(decide("yes").kind).toBe("permission-answer")
    expect(decide("makes sense").kind).toBe("acknowledgement")
  })

  it("priority: noise is only matched on empty / punctuation", () => {
    expect(decide("uh").kind).toBe("continue")
    expect(decide("hmm").kind).toBe("continue")
    expect(decide("ah").kind).toBe("continue")
  })

  it("includes rationale for traceability", () => {
    expect(decide("stop").rationale).toMatch(/^cancel-task:/)
    expect(decide("shh").rationale).toMatch(/^cancel-speech:/)
    expect(decide("actually I meant Linux").rationale).toMatch(/^correction:/)
  })

  it("propagates language and source text on the proposal", () => {
    const proposal = decide("annule ça", "fr")
    expect(proposal.language).toBe("fr")
    expect(proposal.sourceText).toBe("annule ça")
    expect(proposal.emittedAt).toBe(1)
  })

  it("never mutates the input", () => {
    const input = {
      text: "stop",
      language: "en" as const,
      stage: "final" as const,
      capturedAt: 7,
    }
    const snapshot = JSON.stringify(input)
    rulesFastDecisionProvider.decide(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it("never throws on unusual input", () => {
    const odd = ["\u0000", "🎙️", " ".repeat(1000), "STOP STOP STOP"]
    for (const text of odd) {
      expect(() => decide(text)).not.toThrow()
    }
  })
})
