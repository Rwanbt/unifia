/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { EMPTY_GRAPH, graphFromSource, runnableConfig, runnableEdges, runnableSteps, sourceWithGraph, type GraphState } from "./automate-graph-draft"

const base = JSON.stringify({ id: "wf", version: 1, steps: [{ id: "a", family: "tool.http" }] })
const drawn: GraphState = {
  positions: { a: { x: 10, y: 20 } },
  edges: [{ from: "a", to: "b", kind: "flow" }],
  extraNodes: [{ id: "b", label: "If", requiresApproval: false, family: "control.if" }],
}

describe("graph draft", () => {
  test("RoundTrip_PreservesPositionsEdgesAndExtraNodes", () => {
    expect(graphFromSource(sourceWithGraph(base, drawn))).toEqual(drawn)
  })
  test("WriteGraph_KeepsIdVersionAndSteps", () => {
    const written = JSON.parse(sourceWithGraph(base, drawn))
    expect(written.id).toBe("wf")
    expect(written.version).toBe(1)
    expect(written.steps).toEqual([{ id: "a", family: "tool.http" }])
  })
  test("EmptyGraph_RemovesTheUiField", () => {
    expect(JSON.parse(sourceWithGraph(sourceWithGraph(base, drawn), EMPTY_GRAPH))).not.toHaveProperty("ui")
  })
  test("FileWithoutUi_GivesAnEmptyGraph", () => expect(graphFromSource(base)).toEqual(EMPTY_GRAPH))
  test("InvalidJson_IsUnreadableAndLeftUntouched", () => {
    expect(graphFromSource("{ nope")).toBeUndefined()
    expect(sourceWithGraph("{ nope", drawn)).toBe("{ nope")
  })
  test("MalformedUi_DropsOnlyTheBadEntries", () => {
    const source = JSON.stringify({ id: "x", version: 1, steps: [], ui: { positions: { a: { x: 1 }, b: { x: 2, y: 3 } }, edges: [{ from: 1 }, { from: "a", to: "b" }] } })
    const graph = graphFromSource(source)
    expect(graph?.positions).toEqual({ b: { x: 2, y: 3 } })
    expect(graph?.edges).toEqual([{ from: "a", to: "b" }])
  })
  test("RunnableSteps_AppendsLibraryNodesAsSteps", () => {
    const steps = runnableSteps([{ id: "a" }], drawn.extraNodes)
    expect(steps).toEqual([{ id: "a" }, { id: "b", family: "control.if", config: { condition: "" } }])
  })
})

describe("runnableEdges", () => {
  const steps = [{ id: "a" }, { id: "b" }, { id: "c" }]

  test("nothing drawn keeps the runtime's sequential chain (undefined)", () => {
    expect(runnableEdges(steps, [], [])).toBeUndefined()
  })

  test("a drawn edge replaces the default link out of its source and keeps the others", () => {
    expect(runnableEdges(steps, [], [{ from: "a", to: "c" }])).toEqual([
      { from: "b", to: "c", kind: "flow" },
      { from: "a", to: "c", kind: "flow" },
    ])
  })

  test("a branching step gets only its drawn true and false edges", () => {
    const withIf = [{ id: "a" }, { id: "gate", family: "control.if" }, { id: "y" }, { id: "n" }]
    expect(
      runnableEdges(withIf, [], [
        { from: "gate", to: "y", kind: "branch-true" },
        { from: "gate", to: "n", kind: "branch-false" },
      ]),
    ).toEqual([
      { from: "a", to: "gate", kind: "flow" },
      { from: "y", to: "n", kind: "flow" },
      { from: "gate", to: "y", kind: "branch-true" },
      { from: "gate", to: "n", kind: "branch-false" },
    ])
  })

  test("edges to unknown nodes and self loops are dropped, library nodes can be connected", () => {
    const extra = [{ id: "lib", label: "If", requiresApproval: false }]
    expect(
      runnableEdges(steps, extra, [
        { from: "c", to: "lib" },
        { from: "c", to: "ghost" },
        { from: "b", to: "b" },
      ]),
    ).toEqual([
      { from: "a", to: "b", kind: "flow" },
      { from: "b", to: "c", kind: "flow" },
      { from: "c", to: "lib", kind: "flow" },
    ])
  })
})

describe("runnableConfig", () => {
  const ifNode = { id: "gate", label: "If", requiresApproval: false, family: "control.if" }
  const mergeNode = { id: "join", label: "Merge", requiresApproval: false, family: "control.merge" }

  test("control.if sends the typed condition, empty until the author writes one", () => {
    expect(runnableConfig(ifNode, [])).toEqual({ condition: "" })
    expect(runnableConfig({ ...ifNode, config: { condition: "$node.a.json.n > 2" } }, [])).toEqual({
      condition: "$node.a.json.n > 2",
    })
  })

  test("control.merge waits on the nodes drawn into it, once each, and defaults to all", () => {
    const drawnEdges = [
      { from: "y", to: "join", kind: "flow" as const },
      { from: "n", to: "join", kind: "flow" as const },
      { from: "y", to: "join", kind: "flow" as const },
      { from: "join", to: "after", kind: "flow" as const },
    ]
    expect(runnableConfig(mergeNode, drawnEdges)).toEqual({ strategy: "all", branches: ["y", "n"] })
    expect(runnableConfig({ ...mergeNode, config: { strategy: "any" } }, drawnEdges).strategy).toBe("any")
  })

  test("other families keep the empty config, and runnableSteps carries each node's own config", () => {
    expect(runnableConfig({ id: "w", label: "Wait", requiresApproval: false, family: "wait" }, [])).toEqual({})
    const steps = runnableSteps([{ id: "a" }], [ifNode], [])
    expect(steps).toEqual([{ id: "a" }, { id: "gate", family: "control.if", config: { condition: "" } }])
  })
})
