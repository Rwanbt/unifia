/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { EMPTY_GRAPH, graphFromSource, runnableSteps, sourceWithGraph, type GraphState } from "./automate-graph-draft"

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
    expect(steps).toEqual([{ id: "a" }, { id: "b", family: "control.if", config: {} }])
  })
})
