/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import {
  NODE_GAP_Y,
  NODE_HEIGHT,
  NODE_WIDTH,
  PADDING,
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
