/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-TEST — graph property tests (Plan V2.3.1 §199, ADR-002).
 *
 * Six categories of property-based tests over the Workflow IR
 * (M2-01..06 are all landed — 11 node families, 6 EdgeKind):
 *   (1) Well-formedness: edges reference existing nodes, no cycles.
 *   (2) Fan-out / fan-in: parallel + merge pairing, sample workflow.
 *   (3) Parallel race / dynamic identity: deterministic node ids.
 *   (4) Bounded loops: control.repeat is always finite.
 *   (5) Stable map keys: idempotence under reordering.
 *   (6) IR-level integration: all control families parse + validate.
 */
import { describe, expect, test } from "bun:test"
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type Node,
  type Edge,
} from "../src/workflow-ir.ts"
import {
  findOrphanEdgeReferences,
  findCycles,
  findUnreachableNodes,
  findUnpairedParallelMerge,
  findUnboundedLoops,
  deriveMapKey,
} from "./graph-validators.ts"

// -----------------------------------------------------------------------
// Fixtures / builders
// -----------------------------------------------------------------------

const SCOPE = { organizationId: "o1", workspaceId: "w1" } as const

function makeNode(id: string, family: Node["family"], config: Record<string, unknown> = {}): Node {
  return { id, family, config }
}

function makeEdge(from: string, to: string, kind: Edge["kind"] = "flow"): Edge {
  return { from, to, kind }
}

function baseFields(): Omit<WorkflowDefinition, "nodes" | "edges"> {
  return {
    definitionId: "d-m2-test",
    ownershipScope: SCOPE,
    displayName: "M2-TEST fixture",
    concurrency: { kind: "none" },
    defaultFailurePolicy: { kind: "propagate" },
    defaultTimeoutMs: 30_000,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  }
}

function linearGraph(n: number): WorkflowDefinition {
  const nodes: Node[] = []
  const edges: Edge[] = []
  for (let i = 0; i < n; i++) nodes.push(makeNode(`n${i}`, "tool.http"))
  for (let i = 0; i < n - 1; i++) edges.push(makeEdge(`n${i}`, `n${i + 1}`))
  return { ...baseFields(), nodes, edges }
}

// -----------------------------------------------------------------------
// (1-4) Well-formedness
// -----------------------------------------------------------------------

describe("findOrphanEdgeReferences — well-formedness (1, 2)", () => {
  test("(1) findOrphanEdgeReferences_NoOrphansOnLinearGraph — A→B→C returns 0 issues", () => {
    const def = linearGraph(3)
    expect(findOrphanEdgeReferences(def)).toEqual([])
  })

  test("(2) findOrphanEdgeReferences_DetectsOrphanRef — edge {from: 'ghost', to: 'b'} returns 1 issue", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("a", "tool.http"), makeNode("b", "tool.http")],
      edges: [makeEdge("ghost", "b")],
    }
    const issues = findOrphanEdgeReferences(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("EDGE_FROM_NOT_FOUND")
    expect(issues[0].edgeIndex).toBe(0)
  })
})

describe("findCycles — well-formedness (3, 4)", () => {
  test("(3) findCycles_NoCyclesOnLinearGraph — A→B→C returns 0 issues", () => {
    const def = linearGraph(3)
    expect(findCycles(def)).toEqual([])
  })

  test("(4) findCycles_DetectsDirectCycle — A→A returns 1 issue", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("a", "tool.http")],
      edges: [makeEdge("a", "a")],
    }
    const issues = findCycles(def)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("CYCLE_DETECTED")
    expect(issues[0].nodeId).toBe("a")
  })
})

// -----------------------------------------------------------------------
// (5-7) Fan-out / fan-in
// -----------------------------------------------------------------------

describe("findUnpairedParallelMerge — fan-out/fan-in (5, 6, 7)", () => {
  test("(5) findUnpairedParallelMerge_PassForMatchedPair — parallel (3 branches) + merge (3 branches) → 0", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("p", "control.parallel", {
          branches: [
            { branchId: "alpha", target: "a" },
            { branchId: "beta", target: "b" },
            { branchId: "gamma", target: "c" },
          ],
        }),
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
        makeNode("m", "control.merge", { strategy: "all", branches: ["a", "b", "c"] }),
      ],
      edges: [
        makeEdge("p", "a", "branch-N"),
        makeEdge("p", "b", "branch-N"),
        makeEdge("p", "c", "branch-N"),
        makeEdge("a", "m"),
        makeEdge("b", "m"),
        makeEdge("c", "m"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
  })

  test("(6) findUnpairedParallelMerge_DetectsUnpairedMerge — merge with 3 branches but no upstream parallel → 1", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
        makeNode("m", "control.merge", { strategy: "all", branches: ["a", "b", "c"] }),
      ],
      edges: [
        makeEdge("a", "m"),
        makeEdge("b", "m"),
        makeEdge("c", "m"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findUnpairedParallelMerge(parsed)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("MERGE_WITHOUT_PARALLEL")
    expect(issues[0].nodeId).toBe("m")
  })

  test("(7) FanOut_FanIn_SampleWorkflow — parallel + merge + downstream parses and validates", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("t", "trigger.manual"),
        makeNode("p", "control.parallel", {
          branches: [
            { branchId: "a", target: "x" },
            { branchId: "b", target: "y" },
          ],
        }),
        makeNode("x", "tool.http"),
        makeNode("y", "tool.http"),
        makeNode("m", "control.merge", { strategy: "all", branches: ["x", "y"] }),
        makeNode("d", "tool.http"),
      ],
      edges: [
        makeEdge("t", "p"),
        makeEdge("p", "x", "branch-N"),
        makeEdge("p", "y", "branch-N"),
        makeEdge("x", "m"),
        makeEdge("y", "m"),
        makeEdge("m", "d"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(parsed.nodes).toHaveLength(6)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// (8-10) Parallel race / dynamic identity
// -----------------------------------------------------------------------

describe("Parallel race / dynamic identity (8, 9, 10)", () => {
  test("(8) DynamicIdentity_NodeIdExpression_ParsesAsWarning — id '{input.x}' parses (IR doesn't reject dynamic ids)", () => {
    // The IR keeps `id` as a plain string — the editor/runtime may warn
    // about dynamic ids, but the schema accepts them.
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("{input.x}", "tool.http"),
        makeNode("next", "tool.http"),
      ],
      edges: [makeEdge("{input.x}", "next")],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(parsed.nodes[0].id).toBe("{input.x}")
    // No validator rejects this — that's intentional, per the spec.
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
  })

  test("(9) DeterministicIdentity_SameIdProducesSameRunId — same definition canonicalizes to same id set", () => {
    const def = linearGraph(5)
    const parsed1 = WorkflowDefinitionSchema.parse(def)
    const parsed2 = WorkflowDefinitionSchema.parse(def)
    const ids1 = parsed1.nodes.map((n) => n.id).sort()
    const ids2 = parsed2.nodes.map((n) => n.id).sort()
    expect(ids1).toEqual(ids2)
    expect(ids1).toEqual(["n0", "n1", "n2", "n3", "n4"])
  })

  test("(10) ParallelRace_TwoParsesSameIdempotentIds — parallel parsed twice yields same branchId set in order", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("p", "control.parallel", {
          branches: [
            { branchId: "alpha", target: "a" },
            { branchId: "beta", target: "b" },
            { branchId: "gamma", target: "c" },
          ],
        }),
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
      ],
      edges: [
        makeEdge("p", "a", "branch-N"),
        makeEdge("p", "b", "branch-N"),
        makeEdge("p", "c", "branch-N"),
      ],
    }
    const cfg1 = (WorkflowDefinitionSchema.parse(def).nodes[0].config as { branches: { branchId: string }[] }).branches
    const cfg2 = (WorkflowDefinitionSchema.parse(def).nodes[0].config as { branches: { branchId: string }[] }).branches
    expect(cfg1.map((b) => b.branchId)).toEqual(cfg2.map((b) => b.branchId))
    expect(cfg1.map((b) => b.branchId)).toEqual(["alpha", "beta", "gamma"])
  })
})

// -----------------------------------------------------------------------
// (11-13) Bounded loops
// -----------------------------------------------------------------------

describe("Bounded loops (11, 12, 13)", () => {
  test("(11) findUnboundedLoops_DetectsUnboundedRepeat — maxIterations: 0 is caught at the validator level", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 0, body: "x" })],
      edges: [],
    }
    // The schema doesn't reject this (config is opaque), but the
    // validator does.
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findUnboundedLoops(parsed)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].code).toBe("REPEAT_UNBOUNDED")
  })

  test("(12) BoundedLoop_RepeatWithMaxIterations1_Validates — maxIterations: 1 is valid", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 1, body: "x" })],
      edges: [],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findUnboundedLoops(parsed)).toEqual([])
  })

  test("(13) BoundedLoop_RepeatWith1Million_Validates — maxIterations: 1_000_000 (the upper bound) is valid", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [makeNode("r", "control.repeat", { maxIterations: 1_000_000, body: "x" })],
      edges: [],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// (14-16) Stable map keys
// -----------------------------------------------------------------------

describe("Stable map keys (14, 15, 16)", () => {
  test("(14) deriveMapKey_FieldStrategy_ExtractsField — { strategy: 'field', field: 'id' } on { id: 'abc' } → 'abc'", () => {
    const key = deriveMapKey({ strategy: "field", field: "id" }, { id: "abc", other: 1 })
    expect(key).toBe("abc")
  })

  test("(15) deriveMapKey_HashStrategy_Deterministic — same item twice returns the same key", () => {
    const item = { id: "abc", n: 42, nested: { x: 1, y: 2 } }
    const k1 = deriveMapKey({ strategy: "hash" }, item)
    const k2 = deriveMapKey({ strategy: "hash" }, item)
    expect(k1).toBe(k2)
    expect(k1.length).toBeGreaterThan(0)
  })

  test("(16) StableMapKeys_ReorderedInputProducesSameKeys — [a, b, c] and [c, a, b] produce the same key set", () => {
    const items1 = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "c", v: 3 },
    ]
    const items2 = [
      { id: "c", v: 3 },
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ]
    const ks1 = items1.map((i) => deriveMapKey({ strategy: "field", field: "id" }, i)).sort()
    const ks2 = items2.map((i) => deriveMapKey({ strategy: "field", field: "id" }, i)).sort()
    expect(ks1).toEqual(ks2)
    expect(ks1).toEqual(["a", "b", "c"])
  })
})

// -----------------------------------------------------------------------
// (17-20) IR-level integration
// -----------------------------------------------------------------------

describe("IR-level integration (17, 18, 19, 20)", () => {
  test("(17) SampleWorkflow_AllControlFamilies_ParseAndValidate — one node per control family (if, switch, parallel, merge, map, repeat)", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("t", "trigger.manual"),
        makeNode("if1", "control.if", { condition: "input.x === 'go'", trueBranch: "sw", falseBranch: "rep" }),
        makeNode("sw", "control.switch", {
          discriminator: "input.y",
          cases: [{ value: "a", target: "par" }],
        }),
        makeNode("par", "control.parallel", {
          branches: [
            { branchId: "a", target: "ma" },
            { branchId: "b", target: "mb" },
          ],
        }),
        makeNode("ma", "tool.http"),
        makeNode("mb", "tool.http"),
        makeNode("merge", "control.merge", { strategy: "all", branches: ["ma", "mb"] }),
        makeNode("map", "control.map", { input: "input.items", body: "body", key: { strategy: "field", field: "id" } }),
        makeNode("body", "tool.http"),
        makeNode("rep", "control.repeat", { maxIterations: 5, body: "body" }),
        makeNode("sink", "tool.http"),
      ],
      edges: [
        makeEdge("t", "if1"),
        makeEdge("if1", "sw", "branch-true"),
        makeEdge("if1", "rep", "branch-false"),
        makeEdge("sw", "par", "case-value"),
        makeEdge("par", "ma", "branch-N"),
        makeEdge("par", "mb", "branch-N"),
        makeEdge("ma", "merge"),
        makeEdge("mb", "merge"),
        makeEdge("merge", "map"),
        makeEdge("map", "body"),
        makeEdge("body", "sink"),
        makeEdge("rep", "sink"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })

  test("(18) SampleWorkflow_WithCycle_RejectedByFindCycles — a workflow with a cycle is rejected at the topology level", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("c", "tool.http"),
      ],
      edges: [
        makeEdge("a", "b"),
        makeEdge("b", "c"),
        makeEdge("c", "a"),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findCycles(parsed)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].code).toBe("CYCLE_DETECTED")
  })

  test("(19) SampleWorkflow_WithUnreachableNode_Detected — a node disconnected from the entry point is reported", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [
        makeNode("t", "trigger.manual"),
        makeNode("a", "tool.http"),
        makeNode("b", "tool.http"),
        makeNode("orphan", "tool.http"),
      ],
      edges: [
        makeEdge("t", "a"),
        makeEdge("a", "b"),
        // `orphan` has no edges connecting it to the entry point.
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    const issues = findUnreachableNodes(parsed)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe("UNREACHABLE_NODE")
    expect(issues[0].nodeId).toBe("orphan")
  })

  test("(20) EmptyWorkflow_ValidatesEmpty — 0 nodes + 0 edges is trivially valid", () => {
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [],
      edges: [],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})

// -----------------------------------------------------------------------
// (21, 22) Edge case — performance / boundary
// -----------------------------------------------------------------------

describe("Edge case — performance / boundary (21, 22)", () => {
  test("(21) LinearGraph_50Nodes_NoIssues — 50-node linear graph validates (performance sanity)", () => {
    const def = linearGraph(50)
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })

  test("(22) WideGraph_100Branches_ParallelValidates — 64-branch parallel (schema max) validates", () => {
    const N = 64
    const branchNodes: Node[] = []
    const edges: Edge[] = []
    for (let i = 0; i < N; i++) {
      const id = `b${i}`
      branchNodes.push(makeNode(id, "tool.http"))
      edges.push(makeEdge("p", id, "branch-N"))
    }
    const parallel: Node = makeNode("p", "control.parallel", {
      branches: Array.from({ length: N }, (_, i) => ({
        branchId: `br${i}`,
        target: `b${i}`,
      })),
    })
    const merge: Node = makeNode("m", "control.merge", {
      strategy: "all",
      branches: Array.from({ length: N }, (_, i) => `b${i}`),
    })
    const def: WorkflowDefinition = {
      ...baseFields(),
      nodes: [parallel, ...branchNodes, merge],
      edges: [
        ...edges,
        ...Array.from({ length: N }, (_, i) => makeEdge(`b${i}`, "m")),
      ],
    }
    const parsed = WorkflowDefinitionSchema.parse(def)
    expect(findOrphanEdgeReferences(parsed)).toEqual([])
    expect(findCycles(parsed)).toEqual([])
    expect(findUnreachableNodes(parsed)).toEqual([])
    expect(findUnpairedParallelMerge(parsed)).toEqual([])
    expect(findUnboundedLoops(parsed)).toEqual([])
  })
})
