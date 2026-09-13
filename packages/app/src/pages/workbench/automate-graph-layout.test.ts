/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import {
  NODE_GAP_Y,
  NODE_HEIGHT,
  NODE_WIDTH,
  PADDING,
  edgeEndpoints,
  layoutWorkflowSteps,
} from "./automate-graph-layout"
import type { WorkflowStepSummary } from "./automate-workflow-model"

function step(id: string, label: string, requiresApproval = false): WorkflowStepSummary {
  return { id, label, requiresApproval }
}

describe("layoutWorkflowSteps", () => {
  test("returns an empty graph for an empty input", () => {
    const graph = layoutWorkflowSteps([])
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
    expect(graph.width).toBe(0)
    expect(graph.height).toBe(0)
  })

  test("lays out a single step at the origin padding without edges", () => {
    const graph = layoutWorkflowSteps([step("only", "capability.read")])
    expect(graph.nodes).toHaveLength(1)
    expect(graph.edges).toHaveLength(0)
    expect(graph.nodes[0]).toMatchObject({
      id: "only",
      x: PADDING,
      y: PADDING,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      label: "capability.read",
      requiresApproval: false,
    })
    expect(graph.width).toBe(PADDING * 2 + NODE_WIDTH)
    expect(graph.height).toBe(PADDING * 2 + NODE_HEIGHT)
  })

  test("stacks multiple steps vertically with one edge between each consecutive pair", () => {
    const graph = layoutWorkflowSteps([
      step("a", "capability.read"),
      step("b", "capability.write"),
      step("c", "capability.publish", true),
    ])
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(2)
    // Vertical layout — same x for every step, y increases by NODE_HEIGHT + GAP.
    expect(graph.nodes[0]?.y).toBe(PADDING)
    expect(graph.nodes[1]?.y).toBe(PADDING + NODE_HEIGHT + NODE_GAP_Y)
    expect(graph.nodes[2]?.y).toBe(PADDING + 2 * (NODE_HEIGHT + NODE_GAP_Y))
    // Edges go from previous.x+width to next.x at the vertical midline.
    expect(graph.edges[0]).toMatchObject({
      from: "a",
      to: "b",
      x1: PADDING + NODE_WIDTH,
      y1: PADDING + NODE_HEIGHT / 2,
      x2: PADDING,
      y2: PADDING + NODE_HEIGHT + NODE_GAP_Y + NODE_HEIGHT / 2,
    })
    expect(graph.edges[1]?.from).toBe("b")
    expect(graph.edges[1]?.to).toBe("c")
    // The approval flag is preserved on the laid-out node.
    expect(graph.nodes[2]?.requiresApproval).toBe(true)
  })

  test("computes a deterministic bounding box sized for the entire pipeline", () => {
    const steps: WorkflowStepSummary[] = []
    for (let index = 0; index < 5; index += 1) steps.push(step(`s${index}`, `label-${index}`))
    const graph = layoutWorkflowSteps(steps)
    expect(graph.nodes).toHaveLength(5)
    expect(graph.edges).toHaveLength(4)
    expect(graph.width).toBe(PADDING * 2 + NODE_WIDTH)
    expect(graph.height).toBe(PADDING * 2 + 5 * NODE_HEIGHT + 4 * NODE_GAP_Y)
  })
})

describe("edgeEndpoints", () => {
  test("falls back to the laid-out endpoint when no override exists", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b")])
    const endpoints = edgeEndpoints(graph, {})
    expect(endpoints).toHaveLength(1)
    // Source is a's right edge at vertical midline; target is b's left edge.
    expect(endpoints[0]).toMatchObject({
      from: "a",
      to: "b",
      x1: PADDING + NODE_WIDTH,
      y1: PADDING + NODE_HEIGHT / 2,
      x2: PADDING,
      y2: PADDING + NODE_HEIGHT + NODE_GAP_Y + NODE_HEIGHT / 2,
    })
  })

  test("follows the source node when the user dragged it", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b")])
    const overrides = { a: { x: 500, y: 120 } }
    const endpoints = edgeEndpoints(graph, overrides)
    expect(endpoints).toHaveLength(1)
    // Source's x/y come from the override; target stays laid-out.
    expect(endpoints[0]?.x1).toBe(500 + NODE_WIDTH)
    expect(endpoints[0]?.y1).toBe(120 + NODE_HEIGHT / 2)
    expect(endpoints[0]?.x2).toBe(PADDING)
    expect(endpoints[0]?.y2).toBe(PADDING + NODE_HEIGHT + NODE_GAP_Y + NODE_HEIGHT / 2)
  })

  test("follows the target node when the user dragged it", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b")])
    const overrides = { b: { x: 800, y: 600 } }
    const endpoints = edgeEndpoints(graph, overrides)
    expect(endpoints[0]?.x1).toBe(PADDING + NODE_WIDTH)
    expect(endpoints[0]?.y1).toBe(PADDING + NODE_HEIGHT / 2)
    expect(endpoints[0]?.x2).toBe(800)
    expect(endpoints[0]?.y2).toBe(600 + NODE_HEIGHT / 2)
  })

  test("follows both endpoints when both nodes were dragged", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b"), step("c", "cap.c")])
    const overrides = { a: { x: 200, y: 50 }, b: { x: 600, y: 250 } }
    const endpoints = edgeEndpoints(graph, overrides)
    expect(endpoints).toHaveLength(2)
    // a→b edge: source from a's override, target from b's override.
    expect(endpoints[0]).toMatchObject({ from: "a", to: "b", x1: 200 + NODE_WIDTH, y1: 50 + NODE_HEIGHT / 2, x2: 600, y2: 250 + NODE_HEIGHT / 2 })
    // b→c edge: source from b's override, target falls back to layout.
    expect(endpoints[1]).toMatchObject({ from: "b", to: "c", x1: 600 + NODE_WIDTH, y1: 250 + NODE_HEIGHT / 2, x2: PADDING, y2: PADDING + 2 * (NODE_HEIGHT + NODE_GAP_Y) + NODE_HEIGHT / 2 })
  })

  test("returns the original layout endpoint when the edge references an unknown node", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a")])
    // Forge an edge that references a missing target — the helper must
    // not throw, and must fall back to the layout values.
    const broken = { ...graph, edges: [{ from: "a", to: "ghost", x1: 1, y1: 2, x2: 3, y2: 4 }] }
    const endpoints = edgeEndpoints(broken, {})
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ from: "a", to: "ghost", x1: 1, y1: 2, x2: 3, y2: 4 })
  })
})
