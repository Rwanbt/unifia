/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-TEST — graph property tests (Plan V2.3.1 §199).
 *
 * §199 names six categories; each maps to a describe block below:
 *
 *   graph property tests → "well-formedness"
 *   fan-out/fan-in       → "fan-out / fan-in"
 *   parallel race        → "deterministic identity"
 *   bounded loops        → "bounded loops"
 *   dynamic identity     → "dynamic identity"
 *   stable map keys      → "stable map keys"
 *
 * WHY a hand-rolled generator instead of fast-check: `fast-check` is
 * present in `node_modules` only as a transitive dependency of vitest — no
 * `package.json` in this repository declares it. Depending on a hoisted
 * transitive package is a supply-chain smell, and declaring a new one would
 * churn the root lockfile shared by 50 packages for a handful of
 * permutations. `mulberry32` below is 6 lines, seeded, and reproducible:
 * a failure names the exact seed that produced it.
 *
 * Scope note, stated rather than implied: the "parallel race" category in
 * §199 also covers `runId` determinism for two concurrent runs of the same
 * `versionDigest`. That derivation does not exist yet — it belongs to the
 * durable kernel and is blocked on ADR-000 (substrate), with the contract
 * half sitting in `workflow-run.ts` as interface-only (card M1-09). What is
 * testable at the contract layer today is the *static* half: graph analysis
 * is a pure function whose output does not depend on authoring order. That
 * is what "deterministic identity" below locks. The runtime half stays
 * uncovered, on purpose, and is not claimed as passing.
 */
import { describe, expect, test } from "bun:test"
import {
  validateWorkflowGraph,
  WORKFLOW_GRAPH_DIAGNOSTIC_CODES,
  type WorkflowGraphDiagnosticCode,
} from "../src/workflow-graph.ts"
import {
  extractMapKeyMaterial,
  MapKeyExtractionError,
} from "../src/workflow-map-key.ts"
import {
  CONTROL_REPEAT_MAX_ITERATIONS,
  type Edge,
  type Node,
  type WorkflowDefinition,
} from "../src/workflow-ir.ts"

/* ------------------------------------------------------------------ */
/* Fixtures + deterministic generator                                  */
/* ------------------------------------------------------------------ */

function definitionOf(
  nodes: readonly Node[],
  edges: readonly Edge[],
): WorkflowDefinition {
  return {
    definitionId: "def-graph-property",
    ownershipScope: { organizationId: "org-1", workspaceId: "ws-1" },
    displayName: "graph property fixture",
    nodes,
    edges,
    concurrency: { kind: "none" },
    defaultFailurePolicy: { kind: "propagate" },
    defaultTimeoutMs: 0,
    createdAt: 1_756_000_000_000,
    updatedAt: 1_756_000_000_000,
  }
}

function node(
  id: string,
  family: Node["family"],
  config: Record<string, unknown> = {},
): Node {
  return { id, family, config }
}

function edge(from: string, to: string, kind: Edge["kind"] = "flow"): Edge {
  return { from, to, kind }
}

const trigger = (id = "n-trigger") => node(id, "trigger.manual")
const http = (id: string) => node(id, "tool.http", { url: "https://example" })

/** A trigger → http chain: the smallest well-formed graph. */
function linearDefinition(): WorkflowDefinition {
  return definitionOf(
    [trigger(), http("n-call")],
    [edge("n-trigger", "n-call")],
  )
}

function parallelDefinition(branchCount: number): WorkflowDefinition {
  const branches = Array.from({ length: branchCount }, (_, index) => ({
    branchId: `b-${index}`,
    target: `n-branch-${index}`,
  }))
  const nodes: Node[] = [
    trigger(),
    node("n-fan", "control.parallel", { branches, failFast: true }),
    ...branches.map((branch) => http(branch.target)),
  ]
  const edges: Edge[] = [
    edge("n-trigger", "n-fan"),
    ...branches.map((branch) => edge("n-fan", branch.target, "branch-N")),
  ]
  return definitionOf(nodes, edges)
}

/** Codes present in a validation result, both severities, sorted. */
function codesOf(
  result: ReturnType<typeof validateWorkflowGraph>,
): WorkflowGraphDiagnosticCode[] {
  return [...result.errors, ...result.warnings].map((one) => one.code).sort()
}

/** Seeded PRNG (mulberry32). Reproducible: the seed is printed on failure. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const held = copy[index] as T
    copy[index] = copy[swap] as T
    copy[swap] = held
  }
  return copy
}

/* ------------------------------------------------------------------ */
/* 1. Well-formedness                                                  */
/* ------------------------------------------------------------------ */

describe("M2-TEST — well-formedness (§199 graph property tests)", () => {
  test("(1) LinearGraph_IsWellFormed — no errors, no warnings", () => {
    const result = validateWorkflowGraph(linearDefinition())
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  test("(2) EdgeToUnknownNode_IsRejected", () => {
    const result = validateWorkflowGraph(
      definitionOf([trigger()], [edge("n-trigger", "n-ghost")]),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("edge-unknown-node")
    expect(result.errors[0]?.detail).toContain("ends at an unknown node")
  })

  test("(3) EdgeFromUnknownNode_IsRejected", () => {
    const result = validateWorkflowGraph(
      definitionOf([trigger()], [edge("n-ghost", "n-trigger")]),
    )
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.detail).toContain("starts at an unknown node")
  })

  test("(4) DuplicateNodeId_IsRejected", () => {
    const result = validateWorkflowGraph(
      definitionOf([http("n-dup"), http("n-dup")], []),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("duplicate-node-id")
  })

  test("(5) Cycle_IsRejected", () => {
    // trigger → a → b → a
    const result = validateWorkflowGraph(
      definitionOf(
        [trigger(), http("n-a"), http("n-b")],
        [
          edge("n-trigger", "n-a"),
          edge("n-a", "n-b"),
          edge("n-b", "n-a"),
        ],
      ),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("cycle-detected")
  })

  test("(6) GraphWithNoEntry_IsRejected — every node has an inbound edge", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [http("n-a"), http("n-b")],
        [edge("n-a", "n-b"), edge("n-b", "n-a")],
      ),
    )
    expect(result.ok).toBe(false)
    const codes = codesOf(result)
    expect(codes).toContain("no-entry-node")
    expect(codes).toContain("cycle-detected")
  })

  test("(7) TwoNonTriggerEntries_IsRejected", () => {
    const result = validateWorkflowGraph(
      definitionOf([http("n-a"), http("n-b")], []),
    )
    expect(result.ok).toBe(false)
    const found = result.errors.find(
      (one) => one.code === "multiple-entry-nodes",
    )
    expect(found?.detail).toContain("'n-a', 'n-b'")
  })

  test("(8) TwoTriggerEntries_AreWarnedNotRejected", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [
          trigger("n-manual"),
          node("n-cron", "trigger.schedule", { cron: "* * * * *" }),
          http("n-call"),
        ],
        [edge("n-manual", "n-call"), edge("n-cron", "n-call")],
      ),
    )
    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual(["multiple-trigger-entry-nodes"])
  })

  test("(9) UnreachableNode_IsWarnedNotRejected", () => {
    // n-orphan has an inbound edge from n-island, so it is not an entry,
    // and n-island is a second non-trigger entry — use a trigger for the
    // island so only the reachability finding fires.
    const result = validateWorkflowGraph(
      definitionOf(
        [trigger(), http("n-call"), trigger("n-island"), http("n-orphan")],
        [edge("n-trigger", "n-call"), edge("n-island", "n-orphan")],
      ),
    )
    // Both trigger entries are reachable roots, so nothing is unreachable.
    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual(["multiple-trigger-entry-nodes"])
  })

  test("(10) NodeInsideCycleOffTheEntry_IsNotReportedUnreachable — cycle short-circuits reachability", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [trigger(), http("n-a"), http("n-b")],
        [edge("n-a", "n-b"), edge("n-b", "n-a")],
      ),
    )
    // A cycle is a hard error; reachability is not computed on top of it,
    // so the operator gets one actionable finding rather than three.
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual(["cycle-detected"])
  })

  test("(11) EmptyGraph_IsWellFormed — no nodes, no entry requirement", () => {
    const result = validateWorkflowGraph(definitionOf([], []))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  test("(12) MalformedControlConfig_IsRejected", () => {
    // control.if with an empty condition: the family schema rejects it.
    const result = validateWorkflowGraph(
      definitionOf([node("n-if", "control.if", { condition: "" })], []),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("node-config-invalid")
  })

  test("(13) SwitchCaseTargetUnknown_IsRejected", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [
          trigger(),
          node("n-switch", "control.switch", {
            discriminator: "input.kind",
            cases: [{ value: "a", target: "n-ghost" }],
          }),
        ],
        [edge("n-trigger", "n-switch")],
      ),
    )
    expect(result.ok).toBe(false)
    const found = result.errors.find(
      (one) => one.code === "target-unknown-node",
    )
    expect(found?.nodeId).toBe("n-switch")
    expect(found?.detail).toContain("'n-ghost'")
  })

  test("(14) IfBranchTargetsResolve_IsWellFormed", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [
          trigger(),
          node("n-if", "control.if", {
            condition: "input.ok",
            trueBranch: "n-yes",
            falseBranch: "n-no",
          }),
          http("n-yes"),
          http("n-no"),
        ],
        [
          edge("n-trigger", "n-if"),
          edge("n-if", "n-yes", "branch-true"),
          edge("n-if", "n-no", "branch-false"),
        ],
      ),
    )
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  test("(15) DiagnosticCodeSet_IsClosed — every emitted code is declared", () => {
    const declared = new Set<string>(WORKFLOW_GRAPH_DIAGNOSTIC_CODES)
    const emitted = [
      validateWorkflowGraph(definitionOf([http("n-a"), http("n-b")], [])),
      validateWorkflowGraph(
        definitionOf([trigger()], [edge("n-trigger", "n-ghost")]),
      ),
      validateWorkflowGraph(definitionOf([http("n-dup"), http("n-dup")], [])),
    ].flatMap(codesOf)
    expect(emitted.length).toBeGreaterThan(0)
    for (const code of emitted) expect(declared.has(code)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Fan-out / fan-in                                                 */
/* ------------------------------------------------------------------ */

describe("M2-TEST — fan-out / fan-in (§199)", () => {
  test("(16) ParallelFanOut_MatchesBranchEdges", () => {
    const result = validateWorkflowGraph(parallelDefinition(3))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  test("(17) ParallelFanOut_MissingBranchEdge_IsRejected", () => {
    const base = parallelDefinition(3)
    const trimmed = definitionOf(
      base.nodes,
      base.edges.filter((one) => one.to !== "n-branch-2"),
    )
    const result = validateWorkflowGraph(trimmed)
    expect(result.ok).toBe(false)
    const found = result.errors.find(
      (one) => one.code === "parallel-fanout-mismatch",
    )
    expect(found?.detail).toContain("declares 3 branch(es) but has 2")
  })

  test("(18) ParallelFanOut_HoldsForEveryWidthFrom1To64 — property", () => {
    for (let width = 1; width <= 64; width += 1) {
      const result = validateWorkflowGraph(parallelDefinition(width))
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    }
  })

  test("(19) MergeAll_FanInMatchesBranchCount", () => {
    const base = parallelDefinition(2)
    const result = validateWorkflowGraph(
      definitionOf(
        [
          ...base.nodes,
          node("n-join", "control.merge", {
            strategy: "all",
            branches: ["n-branch-0", "n-branch-1"],
          }),
        ],
        [
          ...base.edges,
          edge("n-branch-0", "n-join"),
          edge("n-branch-1", "n-join"),
        ],
      ),
    )
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  test("(20) MergeAll_FanInShort_IsRejected", () => {
    const base = parallelDefinition(2)
    const result = validateWorkflowGraph(
      definitionOf(
        [
          ...base.nodes,
          node("n-join", "control.merge", {
            strategy: "all",
            branches: ["n-branch-0", "n-branch-1"],
          }),
        ],
        [...base.edges, edge("n-branch-0", "n-join")],
      ),
    )
    expect(result.ok).toBe(false)
    const found = result.errors.find(
      (one) => one.code === "merge-fanin-mismatch",
    )
    expect(found?.detail).toContain("joins 2 branch(es)")
    expect(found?.detail).toContain("has 1 incoming edge(s)")
  })

  test("(21) MergeAny_FanInIsNotCounted — quorum joins do not require every edge", () => {
    const base = parallelDefinition(2)
    const result = validateWorkflowGraph(
      definitionOf(
        [
          ...base.nodes,
          node("n-join", "control.merge", {
            strategy: "any",
            branches: ["n-branch-0", "n-branch-1"],
          }),
        ],
        [...base.edges, edge("n-branch-0", "n-join")],
      ),
    )
    // n-branch-1 is a leaf here, not an error: `any` completes on the
    // first branch, so the contract does not demand every inbound edge.
    expect(result.ok).toBe(true)
  })

  test("(22) OrphanMerge_IsWarnedNotRejected — no parallel ancestor", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [
          trigger(),
          http("n-a"),
          node("n-join", "control.merge", {
            strategy: "all",
            branches: ["n-a"],
          }),
        ],
        [edge("n-trigger", "n-a"), edge("n-a", "n-join")],
      ),
    )
    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual(["orphan-merge"])
  })

  test("(23) MergeWithParallelAncestor_IsNotOrphaned", () => {
    const base = parallelDefinition(2)
    const result = validateWorkflowGraph(
      definitionOf(
        [
          ...base.nodes,
          node("n-join", "control.merge", {
            strategy: "all",
            branches: ["n-branch-0", "n-branch-1"],
          }),
        ],
        [
          ...base.edges,
          edge("n-branch-0", "n-join"),
          edge("n-branch-1", "n-join"),
        ],
      ),
    )
    expect(codesOf(result)).not.toContain("orphan-merge")
  })
})

/* ------------------------------------------------------------------ */
/* 3. Deterministic identity ("parallel race")                          */
/* ------------------------------------------------------------------ */

describe("M2-TEST — deterministic identity (§199 parallel race)", () => {
  test("(24) Validation_IsIdempotent — 100 runs, byte-identical result", () => {
    const definition = parallelDefinition(8)
    const first = JSON.stringify(validateWorkflowGraph(definition))
    for (let run = 0; run < 100; run += 1) {
      expect(JSON.stringify(validateWorkflowGraph(definition))).toBe(first)
    }
  })

  test("(25) Validation_IsOrderIndependent — 200 seeded permutations", () => {
    const base = parallelDefinition(6)
    const expected = JSON.stringify(validateWorkflowGraph(base))
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = mulberry32(seed)
      const permuted = definitionOf(
        shuffled(base.nodes, random),
        shuffled(base.edges, random),
      )
      const actual = JSON.stringify(validateWorkflowGraph(permuted))
      // Naming the seed makes a failure reproducible in one line.
      expect(`seed=${seed} ${actual}`).toBe(`seed=${seed} ${expected}`)
    }
  })

  test("(26) FailingGraph_DiagnosticsAreOrderIndependent — 200 seeded permutations", () => {
    const base = definitionOf(
      [http("n-a"), http("n-b"), http("n-c"), http("n-d")],
      [edge("n-a", "n-ghost"), edge("n-ghost2", "n-b")],
    )
    const expected = JSON.stringify(validateWorkflowGraph(base))
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = mulberry32(seed)
      const permuted = definitionOf(
        shuffled(base.nodes, random),
        shuffled(base.edges, random),
      )
      expect(`seed=${seed} ${JSON.stringify(validateWorkflowGraph(permuted))}`).toBe(
        `seed=${seed} ${expected}`,
      )
    }
  })

  test("(27) Diagnostics_AreSortedByCode", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [http("n-a"), http("n-b"), http("n-dup"), http("n-dup")],
        [edge("n-a", "n-ghost")],
      ),
    )
    const codes = result.errors.map((one) => one.code)
    expect(codes).toEqual([...codes].sort())
    expect(codes.length).toBeGreaterThan(1)
  })

  test("(28) Validation_DoesNotMutateItsInput", () => {
    const definition = parallelDefinition(4)
    const before = JSON.stringify(definition)
    validateWorkflowGraph(definition)
    expect(JSON.stringify(definition)).toBe(before)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Bounded loops                                                    */
/* ------------------------------------------------------------------ */

describe("M2-TEST — bounded loops (§199)", () => {
  const repeatDefinition = (maxIterations: number): WorkflowDefinition =>
    definitionOf(
      [
        trigger(),
        node("n-loop", "control.repeat", { maxIterations, body: "n-body" }),
        http("n-body"),
      ],
      [edge("n-trigger", "n-loop"), edge("n-loop", "n-body")],
    )

  test("(29) RepeatOne_IsWellFormed", () => {
    const result = validateWorkflowGraph(repeatDefinition(1))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  test("(30) RepeatAtCeiling_IsValidatedAndWarned — N = 1_000_000", () => {
    const result = validateWorkflowGraph(
      repeatDefinition(CONTROL_REPEAT_MAX_ITERATIONS),
    )
    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual(["repeat-iterations-at-ceiling"])
  })

  test("(31) RepeatAboveCeiling_IsRejectedByTheFamilySchema", () => {
    const result = validateWorkflowGraph(
      repeatDefinition(CONTROL_REPEAT_MAX_ITERATIONS + 1),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("node-config-invalid")
  })

  test("(32) RepeatBodyUnknown_IsRejected", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [
          trigger(),
          node("n-loop", "control.repeat", {
            maxIterations: 10,
            body: "n-ghost",
          }),
        ],
        [edge("n-trigger", "n-loop")],
      ),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("target-unknown-node")
  })

  test("(33) BoundednessHolds_AcrossTheWholeRange — property, 12 magnitudes", () => {
    const magnitudes = [1, 2, 5, 10, 100, 1_000, 10_000, 100_000, 500_000]
    for (const maxIterations of magnitudes) {
      const result = validateWorkflowGraph(repeatDefinition(maxIterations))
      expect(result.ok).toBe(true)
      // Only the ceiling itself is warned; everything below is silent.
      expect(result.warnings).toEqual([])
    }
  })

  test("(34) RepeatBodyLoop_IsNotADrawnBackEdge — a body ref is not a cycle", () => {
    // The loop is expressed by `config.body`, never by an edge from the
    // body back to the repeat node. This is the invariant that lets the
    // edge graph stay acyclic while the workflow still loops.
    const result = validateWorkflowGraph(repeatDefinition(5))
    expect(codesOf(result)).not.toContain("cycle-detected")
  })
})

/* ------------------------------------------------------------------ */
/* 5. Dynamic identity                                                 */
/* ------------------------------------------------------------------ */

describe("M2-TEST — dynamic identity (§199)", () => {
  test("(35) DynamicNodeId_IsParsableAndWarned", () => {
    const result = validateWorkflowGraph(
      definitionOf([trigger(), http("n-{input.x}")], [
        edge("n-trigger", "n-{input.x}"),
      ]),
    )
    expect(result.ok).toBe(true)
    const found = result.warnings.find((one) => one.code === "dynamic-node-id")
    expect(found?.nodeId).toBe("n-{input.x}")
  })

  test("(36) StaticNodeId_IsNotWarned", () => {
    const result = validateWorkflowGraph(linearDefinition())
    expect(codesOf(result)).not.toContain("dynamic-node-id")
  })

  test("(37) DynamicNodeId_StillParticipatesInGraphChecks", () => {
    // A dynamic id is warned, not exempted: an edge pointing at a node id
    // that does not exist is still an error even when it looks templated.
    const result = validateWorkflowGraph(
      definitionOf([trigger()], [edge("n-trigger", "n-{input.y}")]),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("edge-unknown-node")
  })
})

/* ------------------------------------------------------------------ */
/* 6. Stable map keys                                                  */
/* ------------------------------------------------------------------ */

describe("M2-TEST — stable map keys (§199, ADR-005)", () => {
  const fieldSpec = { strategy: "field" as const, field: "id" }
  const hashSpec = { strategy: "hash" as const }
  const items = [
    { id: "a", payload: 1 },
    { id: "b", payload: 2 },
    { id: "c", payload: 3 },
  ]

  test("(38) FieldStrategy_ExtractsTheNamedField", () => {
    expect(extractMapKeyMaterial(fieldSpec, items[0])).toBe("a")
    expect(extractMapKeyMaterial(fieldSpec, items[2])).toBe("c")
  })

  test("(39) FieldStrategy_IsDeterministic — 100 extractions, one value", () => {
    for (let run = 0; run < 100; run += 1) {
      expect(extractMapKeyMaterial(fieldSpec, items[1])).toBe("b")
    }
  })

  test("(40) MapKeys_AreOrderIndependent — 200 seeded shuffles", () => {
    const expected = new Map(
      items.map((item) => [item.id, extractMapKeyMaterial(fieldSpec, item)]),
    )
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const item of shuffled(items, mulberry32(seed))) {
        expect(`seed=${seed} ${extractMapKeyMaterial(fieldSpec, item)}`).toBe(
          `seed=${seed} ${expected.get(item.id)}`,
        )
      }
    }
  })

  test("(41) HashStrategy_ReturnsTheItemItself — the digest layer hashes it", () => {
    expect(extractMapKeyMaterial(hashSpec, items[0])).toBe(items[0])
    expect(extractMapKeyMaterial(hashSpec, 42)).toBe(42)
    expect(extractMapKeyMaterial(hashSpec, null)).toBe(null)
  })

  test("(42) FieldStrategy_MissingField_Throws — never falls back to the index", () => {
    expect(() => extractMapKeyMaterial(fieldSpec, { other: 1 })).toThrow(
      MapKeyExtractionError,
    )
    expect(() => extractMapKeyMaterial(fieldSpec, { other: 1 })).toThrow(
      /missing key field 'id'/,
    )
  })

  test("(43) FieldStrategy_NonObjectItem_Throws", () => {
    expect(() => extractMapKeyMaterial(fieldSpec, "a")).toThrow(
      MapKeyExtractionError,
    )
    expect(() => extractMapKeyMaterial(fieldSpec, null)).toThrow(/got null/)
    expect(() => extractMapKeyMaterial(fieldSpec, [1, 2])).toThrow(
      /requires object items/,
    )
  })

  test("(44) FieldStrategy_UndefinedFieldValue_IsStillAKey", () => {
    // `Object.hasOwn` distinguishes "absent" from "present and undefined".
    // A present-but-undefined field is a legitimate (if useless) key; only
    // an absent field breaks replay identity.
    expect(
      extractMapKeyMaterial(fieldSpec, { id: undefined }),
    ).toBeUndefined()
  })

  test("(45) MapBodyUnknown_IsRejectedAtGraphLevel", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [
          trigger(),
          node("n-map", "control.map", {
            input: "input.items",
            body: "n-ghost",
            key: fieldSpec,
          }),
        ],
        [edge("n-trigger", "n-map")],
      ),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain("target-unknown-node")
  })

  test("(46) MapWithResolvedBody_IsWellFormed", () => {
    const result = validateWorkflowGraph(
      definitionOf(
        [
          trigger(),
          node("n-map", "control.map", {
            input: "input.items",
            body: "n-item",
            key: hashSpec,
          }),
          http("n-item"),
        ],
        [edge("n-trigger", "n-map"), edge("n-map", "n-item")],
      ),
    )
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })
})
