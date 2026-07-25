/**
 * Tests for the lifecycle state machine (TEAM-C08) — structural transition
 * graph (valid AND invalid edges), data-driven promotion conditions,
 * mandatory explicit actions for quarantine/deprecate/trust, and the
 * deprecation replacement-policy requirement.
 */

import { describe, expect, test } from "bun:test"
import {
  LIFECYCLE_STAGES,
  LIFECYCLE_TRANSITIONS,
  LifecycleStore,
  InvalidLifecycleTransitionError,
  LifecyclePromotionConditionsNotMetError,
  MissingExplicitActionError,
  MissingReplacementPolicyError,
  UnknownModelStageError,
  evaluatePromotionConditions,
  isStructurallyValidTransition,
  isTerminalStage,
  requiredExplicitActionKind,
  validTransitionsFrom,
  MIN_PROBATION_MS,
  MIN_LOW_RISK_MS,
  MIN_GENERAL_ELIGIBLE_MS,
  LOW_RISK_MIN_AVAILABILITY,
  LOW_RISK_MAX_ERROR_RATE,
  GENERAL_MIN_AVAILABILITY,
  GENERAL_MAX_ERROR_RATE,
  type LifecycleStage,
  type TransitionEvidence,
} from "../../src/model-intelligence/lifecycle"
import type { ModelHealth } from "../../src/model-intelligence/schema"
import { Model } from "../../src/model-intelligence/schema"

const T0 = Date.parse("2026-01-01T00:00:00Z")

function isoAt(msFromEpoch: number): string {
  return new Date(msFromEpoch).toISOString()
}

function baseHealth(overrides: Partial<ModelHealth> = {}): ModelHealth {
  return {
    lastHealthCheckUTC: isoAt(T0),
    availabilityScore: 0.99,
    latencyP50Ms: 100,
    latencyP95Ms: 200,
    errorRate1h: 0.01,
    rateLimit: null,
    notes: null,
    ...overrides,
  }
}

function baseEvidence(overrides: Partial<TransitionEvidence> = {}): TransitionEvidence {
  return {
    independentSourceCount: 1,
    health: null,
    hasBenchmarkResult: false,
    ...overrides,
  }
}

// =====================================================================
// Stage enum reuse — proves zero duplication of schema.ts's LifecycleStage
// =====================================================================

describe("LIFECYCLE_STAGES — reused from schema.ts, not redefined", () => {
  test("matches Model.shape.lifecycleStage.options exactly", () => {
    expect(LIFECYCLE_STAGES).toEqual(Model.shape.lifecycleStage.options)
  })

  test("has exactly the 8 documented stages", () => {
    expect(LIFECYCLE_STAGES).toEqual([
      "discovered",
      "metadata_validated",
      "probed",
      "low_risk_eligible",
      "general_eligible",
      "trusted_by_domain",
      "deprecated",
      "quarantined",
    ])
  })
})

// =====================================================================
// Structural transition graph — valid AND invalid edges
// =====================================================================

describe("transition graph — structural validity", () => {
  test("happy path: each stage advances to exactly the next stage", () => {
    expect(validTransitionsFrom("discovered")).toContain("metadata_validated")
    expect(validTransitionsFrom("metadata_validated")).toContain("probed")
    expect(validTransitionsFrom("probed")).toContain("low_risk_eligible")
    expect(validTransitionsFrom("low_risk_eligible")).toContain("general_eligible")
    expect(validTransitionsFrom("general_eligible")).toContain("trusted_by_domain")
  })

  test("quarantined is reachable from every non-terminal stage", () => {
    const nonTerminal: LifecycleStage[] = [
      "discovered",
      "metadata_validated",
      "probed",
      "low_risk_eligible",
      "general_eligible",
      "trusted_by_domain",
    ]
    for (const stage of nonTerminal) {
      expect(isStructurallyValidTransition(stage, "quarantined")).toBe(true)
    }
  })

  test("deprecated is reachable ONLY from low_risk_eligible, general_eligible, trusted_by_domain", () => {
    expect(isStructurallyValidTransition("low_risk_eligible", "deprecated")).toBe(true)
    expect(isStructurallyValidTransition("general_eligible", "deprecated")).toBe(true)
    expect(isStructurallyValidTransition("trusted_by_domain", "deprecated")).toBe(true)

    expect(isStructurallyValidTransition("discovered", "deprecated")).toBe(false)
    expect(isStructurallyValidTransition("metadata_validated", "deprecated")).toBe(false)
    expect(isStructurallyValidTransition("probed", "deprecated")).toBe(false)
  })

  test("deprecated and quarantined are terminal — zero outgoing transitions", () => {
    expect(isTerminalStage("deprecated")).toBe(true)
    expect(isTerminalStage("quarantined")).toBe(true)
    expect(validTransitionsFrom("deprecated")).toEqual([])
    expect(validTransitionsFrom("quarantined")).toEqual([])
    for (const target of LIFECYCLE_STAGES) {
      expect(isStructurallyValidTransition("deprecated", target)).toBe(false)
      expect(isStructurallyValidTransition("quarantined", target)).toBe(false)
    }
  })

  test("rejects skipping a stage (discovered -> probed directly)", () => {
    expect(isStructurallyValidTransition("discovered", "probed")).toBe(false)
  })

  test("rejects backward transitions (trusted_by_domain -> low_risk_eligible)", () => {
    expect(isStructurallyValidTransition("trusted_by_domain", "low_risk_eligible")).toBe(false)
  })

  test("rejects self-loops outside the documented graph (probed -> probed)", () => {
    expect(isStructurallyValidTransition("probed", "probed")).toBe(false)
  })

  test("every stage has an explicit entry in LIFECYCLE_TRANSITIONS", () => {
    for (const stage of LIFECYCLE_STAGES) {
      expect(LIFECYCLE_TRANSITIONS[stage]).toBeDefined()
    }
  })
})

// =====================================================================
// requiredExplicitActionKind mapping
// =====================================================================

describe("requiredExplicitActionKind", () => {
  test("quarantined requires quarantine", () => {
    expect(requiredExplicitActionKind("quarantined")).toBe("quarantine")
  })
  test("deprecated requires deprecate", () => {
    expect(requiredExplicitActionKind("deprecated")).toBe("deprecate")
  })
  test("trusted_by_domain requires grant_trust", () => {
    expect(requiredExplicitActionKind("trusted_by_domain")).toBe("grant_trust")
  })
  test("every other stage requires no explicit action", () => {
    for (const stage of ["discovered", "metadata_validated", "probed", "low_risk_eligible", "general_eligible"] as const) {
      expect(requiredExplicitActionKind(stage)).toBeNull()
    }
  })
})

// =====================================================================
// evaluatePromotionConditions — pure function, per-edge
// =====================================================================

describe("evaluatePromotionConditions — discovered -> metadata_validated", () => {
  test("passes with at least one independent source", () => {
    const result = evaluatePromotionConditions(
      "discovered",
      "metadata_validated",
      isoAt(T0),
      baseEvidence({ independentSourceCount: 1, nowUTC: isoAt(T0 + 1000) }),
    )
    expect(result.allowed).toBe(true)
    expect(result.unmetConditions).toEqual([])
  })

  test("fails with zero independent sources", () => {
    const result = evaluatePromotionConditions(
      "discovered",
      "metadata_validated",
      isoAt(T0),
      baseEvidence({ independentSourceCount: 0 }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.length).toBeGreaterThan(0)
  })
})

describe("evaluatePromotionConditions — probed -> low_risk_eligible", () => {
  test("fails when probation window has not elapsed", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      baseEvidence({ nowUTC: isoAt(T0 + MIN_PROBATION_MS - 1), health: baseHealth() }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("probation"))).toBe(true)
  })

  test("fails when no health signal was ever recorded", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      baseEvidence({ nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1), health: null }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("health signal"))).toBe(true)
  })

  test("fails when availabilityScore is below the low-risk threshold", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1),
        health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY - 0.01 }),
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("availabilityScore"))).toBe(true)
  })

  test("fails when errorRate1h exceeds the low-risk threshold", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1),
        health: baseHealth({ errorRate1h: LOW_RISK_MAX_ERROR_RATE + 0.01 }),
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("errorRate1h"))).toBe(true)
  })

  test("passes once probation elapsed and health thresholds are met", () => {
    const result = evaluatePromotionConditions(
      "probed",
      "low_risk_eligible",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1),
        health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      }),
    )
    expect(result.allowed).toBe(true)
    expect(result.unmetConditions).toEqual([])
  })
})

describe("evaluatePromotionConditions — low_risk_eligible -> general_eligible", () => {
  test("fails when the low-risk window has not elapsed", () => {
    const result = evaluatePromotionConditions(
      "low_risk_eligible",
      "general_eligible",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_LOW_RISK_MS - 1),
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("low-risk duration"))).toBe(true)
  })

  test("fails without a benchmark result even when health is excellent", () => {
    const result = evaluatePromotionConditions(
      "low_risk_eligible",
      "general_eligible",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_LOW_RISK_MS + 1),
        health: baseHealth({ availabilityScore: 0.999, errorRate1h: 0 }),
        hasBenchmarkResult: false,
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("benchmark"))).toBe(true)
  })

  test("passes with elapsed window, stricter health thresholds met, and a benchmark result", () => {
    const result = evaluatePromotionConditions(
      "low_risk_eligible",
      "general_eligible",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_LOW_RISK_MS + 1),
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
      }),
    )
    expect(result.allowed).toBe(true)
  })
})

describe("evaluatePromotionConditions — general_eligible -> trusted_by_domain", () => {
  test("fails when the general-eligible window has not elapsed", () => {
    const result = evaluatePromotionConditions(
      "general_eligible",
      "trusted_by_domain",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_GENERAL_ELIGIBLE_MS - 1),
        health: baseHealth(),
        hasBenchmarkResult: true,
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.unmetConditions.some((r) => r.includes("general-eligible duration"))).toBe(true)
  })

  test("passes on data conditions alone (explicit grant_trust action is enforced separately by the store)", () => {
    const result = evaluatePromotionConditions(
      "general_eligible",
      "trusted_by_domain",
      isoAt(T0),
      baseEvidence({
        nowUTC: isoAt(T0 + MIN_GENERAL_ELIGIBLE_MS + 1),
        health: baseHealth(),
        hasBenchmarkResult: true,
      }),
    )
    expect(result.allowed).toBe(true)
  })
})

describe("evaluatePromotionConditions — exceptional edges have no data-driven gate", () => {
  test("any -> quarantined is always data-allowed (gated structurally/procedurally elsewhere)", () => {
    const result = evaluatePromotionConditions("discovered", "quarantined", isoAt(T0), baseEvidence())
    expect(result.allowed).toBe(true)
    expect(result.unmetConditions).toEqual([])
  })

  test("eligible -> deprecated is always data-allowed (gated structurally/procedurally elsewhere)", () => {
    const result = evaluatePromotionConditions("general_eligible", "deprecated", isoAt(T0), baseEvidence())
    expect(result.allowed).toBe(true)
  })
})

// =====================================================================
// LifecycleStore — end-to-end valid happy-path traversal
// =====================================================================

describe("LifecycleStore — happy path traversal", () => {
  function freshStore(): LifecycleStore {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    return store
  }

  test("initialize() sets stage to discovered", () => {
    const store = freshStore()
    expect(store.getStage("anthropic", "claude-sonnet-5")).toEqual({ stage: "discovered", enteredAtUTC: isoAt(T0) })
  })

  test("double initialize() throws", () => {
    const store = freshStore()
    expect(() => store.initialize("anthropic", "claude-sonnet-5")).toThrow(InvalidLifecycleTransitionError)
  })

  test("getStage on an untracked model throws UnknownModelStageError", () => {
    const store = new LifecycleStore()
    expect(() => store.getStage("openai", "gpt-9")).toThrow(UnknownModelStageError)
  })

  test("isTracked reflects initialize()", () => {
    const store = freshStore()
    expect(store.isTracked("anthropic", "claude-sonnet-5")).toBe(true)
    expect(store.isTracked("openai", "gpt-9")).toBe(false)
  })

  test("full traversal discovered -> ... -> trusted_by_domain succeeds and is fully audited", () => {
    const store = freshStore()
    const providerID = "anthropic"
    const modelID = "claude-sonnet-5"
    const seenTransitions: string[] = []
    const unsubscribe = store.onTransition((record) => seenTransitions.push(`${record.from}->${record.to}`))

    let t = T0
    store.transition(providerID, modelID, "metadata_validated", {
      nowUTC: isoAt((t += 1000)),
      independentSourceCount: 1,
      health: null,
      hasBenchmarkResult: false,
    })

    store.transition(providerID, modelID, "probed", {
      nowUTC: isoAt((t += 1000)),
      independentSourceCount: 1,
      health: null,
      hasBenchmarkResult: false,
    })

    store.transition(providerID, modelID, "low_risk_eligible", {
      nowUTC: isoAt((t += MIN_PROBATION_MS + 1)),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })

    store.transition(providerID, modelID, "general_eligible", {
      nowUTC: isoAt((t += MIN_LOW_RISK_MS + 1)),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
    })

    store.transition(providerID, modelID, "trusted_by_domain", {
      nowUTC: isoAt((t += MIN_GENERAL_ELIGIBLE_MS + 1)),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
      explicitAction: { kind: "grant_trust", actor: "erwan", reason: "manual review passed" },
    })

    expect(store.getStage(providerID, modelID).stage).toBe("trusted_by_domain")
    expect(seenTransitions).toEqual([
      "discovered->metadata_validated",
      "metadata_validated->probed",
      "probed->low_risk_eligible",
      "low_risk_eligible->general_eligible",
      "general_eligible->trusted_by_domain",
    ])
    expect(store.history(providerID, modelID).length).toBe(5)
    unsubscribe()
  })
})

// =====================================================================
// LifecycleStore — invalid transitions (structural)
// =====================================================================

describe("LifecycleStore — rejects invalid structural transitions", () => {
  function freshStore(): LifecycleStore {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    return store
  }

  test("rejects skipping a stage (discovered -> probed)", () => {
    const store = freshStore()
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "probed", baseEvidence()),
    ).toThrow(InvalidLifecycleTransitionError)
    // store left unchanged
    expect(store.getStage("anthropic", "claude-sonnet-5").stage).toBe("discovered")
  })

  test("rejects transitioning out of a terminal stage (quarantined -> anything)", () => {
    const store = freshStore()
    store.transition("anthropic", "claude-sonnet-5", "quarantined", {
      ...baseEvidence(),
      explicitAction: { kind: "quarantine", actor: "erwan", reason: "security finding" },
    })
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "discovered", baseEvidence()),
    ).toThrow(InvalidLifecycleTransitionError)
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "metadata_validated", baseEvidence()),
    ).toThrow(InvalidLifecycleTransitionError)
  })

  test("rejects transitioning out of terminal stage deprecated -> anything", () => {
    const store = freshStore()
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-5", "probed", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
      nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    store.transition("anthropic", "claude-sonnet-5", "deprecated", {
      ...baseEvidence(),
      explicitAction: { kind: "deprecate", actor: "erwan", reason: "superseded", replacement: null, explicitlyNoReplacement: true },
    })
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "quarantined", {
        ...baseEvidence(),
        explicitAction: { kind: "quarantine", actor: "erwan", reason: "x" },
      }),
    ).toThrow(InvalidLifecycleTransitionError)
  })
})

// =====================================================================
// LifecycleStore — invalid transitions (unmet promotion conditions)
// =====================================================================

describe("LifecycleStore — rejects transitions with unmet promotion conditions", () => {
  test("rejects probed -> low_risk_eligible before probation window elapses", () => {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", { nowUTC: isoAt(T0 + 1), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-5", "probed", { nowUTC: isoAt(T0 + 2), ...baseEvidence() })

    let captured: unknown = null
    try {
      store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
        nowUTC: isoAt(T0 + 3),
        independentSourceCount: 1,
        health: baseHealth(),
        hasBenchmarkResult: false,
      })
    } catch (e) {
      captured = e
    }
    expect(captured).toBeInstanceOf(LifecyclePromotionConditionsNotMetError)
    expect((captured as InstanceType<typeof LifecyclePromotionConditionsNotMetError>).data.unmetConditions.length).toBeGreaterThan(0)
    // store left unchanged on rejection
    expect(store.getStage("anthropic", "claude-sonnet-5").stage).toBe("probed")
  })
})

// =====================================================================
// LifecycleStore — mandatory explicit actions
// =====================================================================

describe("LifecycleStore — mandatory explicit action for quarantine/deprecate/trust", () => {
  test("rejects quarantine attempt with no explicitAction at all", () => {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "quarantined", baseEvidence()),
    ).toThrow(MissingExplicitActionError)
  })

  test("rejects quarantine attempt when explicitAction.kind mismatches (deprecate supplied instead of quarantine)", () => {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "quarantined", {
        ...baseEvidence(),
        explicitAction: {
          kind: "deprecate",
          actor: "erwan",
          reason: "wrong kind on purpose",
          replacement: null,
          explicitlyNoReplacement: true,
        },
      }),
    ).toThrow(MissingExplicitActionError)
  })

  test("quarantine succeeds immediately from an early stage — no elapsed-time or health precondition", () => {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    const record = store.transition("anthropic", "claude-sonnet-5", "quarantined", {
      nowUTC: isoAt(T0 + 1),
      independentSourceCount: 0,
      health: null,
      hasBenchmarkResult: false,
      explicitAction: { kind: "quarantine", actor: "erwan", reason: "policy violation discovered" },
    })
    expect(record.to).toBe("quarantined")
    expect(record.deprecationSignal).toBeNull()
  })

  test("rejects trusted_by_domain attempt with no explicitAction even if data conditions are satisfied", () => {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-5", "probed", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
      nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    store.transition("anthropic", "claude-sonnet-5", "general_eligible", {
      nowUTC: isoAt(T0 + MIN_PROBATION_MS + MIN_LOW_RISK_MS + 2),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
    })

    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "trusted_by_domain", {
        nowUTC: isoAt(T0 + MIN_PROBATION_MS + MIN_LOW_RISK_MS + MIN_GENERAL_ELIGIBLE_MS + 3),
        independentSourceCount: 1,
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
        // no explicitAction — must be rejected even though data conditions pass
      }),
    ).toThrow(MissingExplicitActionError)
  })

  test("rejects trusted_by_domain with grant_trust action but unmet data conditions (action alone is not sufficient)", () => {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-5", isoAt(T0))
    store.transition("anthropic", "claude-sonnet-5", "metadata_validated", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-5", "probed", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-5", "low_risk_eligible", {
      nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    store.transition("anthropic", "claude-sonnet-5", "general_eligible", {
      nowUTC: isoAt(T0 + MIN_PROBATION_MS + MIN_LOW_RISK_MS + 2),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
      hasBenchmarkResult: true,
    })

    expect(() =>
      store.transition("anthropic", "claude-sonnet-5", "trusted_by_domain", {
        // elapsed time in general_eligible is far too short — data condition fails
        nowUTC: isoAt(T0 + MIN_PROBATION_MS + MIN_LOW_RISK_MS + 3),
        independentSourceCount: 1,
        health: baseHealth({ availabilityScore: GENERAL_MIN_AVAILABILITY, errorRate1h: GENERAL_MAX_ERROR_RATE }),
        hasBenchmarkResult: true,
        explicitAction: { kind: "grant_trust", actor: "erwan", reason: "premature" },
      }),
    ).toThrow(LifecyclePromotionConditionsNotMetError)
  })
})

// =====================================================================
// LifecycleStore — deprecation replacement policy
// =====================================================================

describe("LifecycleStore — deprecation always carries a replacement policy", () => {
  function eligibleStore(): LifecycleStore {
    const store = new LifecycleStore()
    store.initialize("anthropic", "claude-sonnet-4", isoAt(T0))
    store.transition("anthropic", "claude-sonnet-4", "metadata_validated", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-4", "probed", { nowUTC: isoAt(T0), ...baseEvidence() })
    store.transition("anthropic", "claude-sonnet-4", "low_risk_eligible", {
      nowUTC: isoAt(T0 + MIN_PROBATION_MS + 1),
      independentSourceCount: 1,
      health: baseHealth({ availabilityScore: LOW_RISK_MIN_AVAILABILITY, errorRate1h: LOW_RISK_MAX_ERROR_RATE }),
      hasBenchmarkResult: false,
    })
    return store
  }

  test("rejects deprecate action with neither replacement nor explicitlyNoReplacement", () => {
    const store = eligibleStore()
    expect(() =>
      store.transition("anthropic", "claude-sonnet-4", "deprecated", {
        ...baseEvidence(),
        explicitAction: {
          kind: "deprecate",
          actor: "erwan",
          reason: "superseded by claude-sonnet-5",
          replacement: null,
          explicitlyNoReplacement: false,
        },
      }),
    ).toThrow(MissingReplacementPolicyError)
  })

  test("accepts deprecate action with an explicit replacement model, warning mentions it", () => {
    const store = eligibleStore()
    const record = store.transition("anthropic", "claude-sonnet-4", "deprecated", {
      ...baseEvidence(),
      explicitAction: {
        kind: "deprecate",
        actor: "erwan",
        reason: "superseded by claude-sonnet-5",
        replacement: { providerID: "anthropic", modelID: "claude-sonnet-5" },
        explicitlyNoReplacement: false,
      },
    })
    expect(record.deprecationSignal).not.toBeNull()
    expect(record.deprecationSignal!.policy.replacement).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5" })
    expect(record.deprecationSignal!.warning).toContain("anthropic/claude-sonnet-5")
    expect(record.deprecationSignal!.warning.length).toBeGreaterThan(0)
  })

  test("accepts deprecate action with explicitlyNoReplacement: true and no replacement model", () => {
    const store = eligibleStore()
    const record = store.transition("anthropic", "claude-sonnet-4", "deprecated", {
      ...baseEvidence(),
      explicitAction: {
        kind: "deprecate",
        actor: "erwan",
        reason: "discontinued, no successor planned",
        replacement: null,
        explicitlyNoReplacement: true,
      },
    })
    expect(record.deprecationSignal).not.toBeNull()
    expect(record.deprecationSignal!.policy.replacement).toBeNull()
    expect(record.deprecationSignal!.policy.explicitlyNoReplacement).toBe(true)
    expect(record.deprecationSignal!.warning).toContain("no replacement is currently designated")
  })
})
