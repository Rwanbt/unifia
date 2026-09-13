/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import {
  NODE_GAP_Y,
  NODE_HEIGHT,
  NODE_WIDTH,
  PADDING,
  PORT_HIT_RADIUS,
  PORT_RADIUS,
  closestInputPortDistance,
  hasEdge,
  layoutWorkflowSteps,
  mergeEndpoints,
  nearestInputPortId,
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

describe("mergeEndpoints", () => {
  test("returns synthetic edges when no user edges are provided", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b")])
    const endpoints = mergeEndpoints(graph, {}, [])
    expect(endpoints).toHaveLength(1)
    // Source is a's right edge at vertical midline; target is b's left edge.
    expect(endpoints[0]).toMatchObject({
      from: "a",
      to: "b",
      user: false,
      x1: PADDING + NODE_WIDTH,
      y1: PADDING + NODE_HEIGHT / 2,
      x2: PADDING,
      y2: PADDING + NODE_HEIGHT + NODE_GAP_Y + NODE_HEIGHT / 2,
    })
  })

  test("appends user edges after the synthetic ones with user=true", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b"), step("c", "cap.c")])
    const endpoints = mergeEndpoints(graph, {}, [{ from: "a", to: "c" }])
    expect(endpoints).toHaveLength(3) // 2 synthetic + 1 user
    expect(endpoints[0]?.user).toBe(false)
    expect(endpoints[1]?.user).toBe(false)
    expect(endpoints[2]).toMatchObject({ from: "a", to: "c", user: true })
  })

  test("follows the source node when the user dragged it (synthetic)", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b")])
    const overrides = { a: { x: 500, y: 120 } }
    const endpoints = mergeEndpoints(graph, overrides, [])
    expect(endpoints).toHaveLength(1)
    // Source's x/y come from the override; target stays laid-out.
    expect(endpoints[0]?.x1).toBe(500 + NODE_WIDTH)
    expect(endpoints[0]?.y1).toBe(120 + NODE_HEIGHT / 2)
    expect(endpoints[0]?.x2).toBe(PADDING)
    expect(endpoints[0]?.y2).toBe(PADDING + NODE_HEIGHT + NODE_GAP_Y + NODE_HEIGHT / 2)
  })

  test("follows the target node when the user dragged it (synthetic)", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b")])
    const overrides = { b: { x: 800, y: 600 } }
    const endpoints = mergeEndpoints(graph, overrides, [])
    expect(endpoints[0]?.x1).toBe(PADDING + NODE_WIDTH)
    expect(endpoints[0]?.y1).toBe(PADDING + NODE_HEIGHT / 2)
    expect(endpoints[0]?.x2).toBe(800)
    expect(endpoints[0]?.y2).toBe(600 + NODE_HEIGHT / 2)
  })

  test("follows both endpoints when both nodes were dragged", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b"), step("c", "cap.c")])
    const overrides = { a: { x: 200, y: 50 }, b: { x: 600, y: 250 } }
    const endpoints = mergeEndpoints(graph, overrides, [])
    expect(endpoints).toHaveLength(2)
    expect(endpoints[0]).toMatchObject({ from: "a", to: "b", x1: 200 + NODE_WIDTH, y1: 50 + NODE_HEIGHT / 2, x2: 600, y2: 250 + NODE_HEIGHT / 2 })
    expect(endpoints[1]).toMatchObject({ from: "b", to: "c", x1: 600 + NODE_WIDTH, y1: 250 + NODE_HEIGHT / 2, x2: PADDING, y2: PADDING + 2 * (NODE_HEIGHT + NODE_GAP_Y) + NODE_HEIGHT / 2 })
  })

  test("renders a zero endpoint for an unknown node reference", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a")])
    // Forge an edge that references a missing target — the helper must
    // not throw, and must fall back to a safe zero endpoint.
    const broken = { ...graph, edges: [{ from: "a", to: "ghost", x1: 1, y1: 2, x2: 3, y2: 4 }] }
    const endpoints = mergeEndpoints(broken, {}, [])
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ from: "a", to: "ghost", user: false, x1: 0, y1: 0, x2: 0, y2: 0 })
  })
})

describe("layoutWorkflowSteps with extraNodes (slice 5)", () => {
  test("extends the stack with extraNodes after the legacy steps", () => {
    const graph = layoutWorkflowSteps(
      [step("a", "cap.a"), step("b", "cap.b")],
      [{ id: "lib-1", label: "If / else", requiresApproval: false, family: "control.if" }],
    )
    expect(graph.nodes).toHaveLength(3)
    expect(graph.nodes[0]?.id).toBe("a")
    expect(graph.nodes[1]?.id).toBe("b")
    expect(graph.nodes[2]?.id).toBe("lib-1")
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges[0]?.from).toBe("a")
    expect(graph.edges[0]?.to).toBe("b")
    expect(graph.edges[1]?.from).toBe("b")
    expect(graph.edges[1]?.to).toBe("lib-1")
    expect(graph.nodes[2]?.family).toBe("control.if")
  })

  test("works with only extraNodes and no legacy steps", () => {
    const graph = layoutWorkflowSteps([], [step("only-lib", "transform"), step("second", "approval", true)])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({ from: "only-lib", to: "second" })
  })
})

describe("port hit-test helpers", () => {
  test("PORT_HIT_RADIUS exceeds PORT_RADIUS so drop zones are forgiving", () => {
    // Anti-regression: a future tuning of the rendered port radius
    // must not silently shrink the hit zone.
    expect(PORT_HIT_RADIUS).toBeGreaterThan(PORT_RADIUS)
  })

  test("nearestInputPortId returns the closest node by Euclidean distance", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b"), step("c", "cap.c")])
    // a sits at (PADDING, PADDING), b below a, c below b — all on x=PADDING.
    expect(nearestInputPortId(graph, {}, PADDING, PADDING + NODE_HEIGHT / 2)).toBe("a")
    expect(nearestInputPortId(graph, {}, PADDING, PADDING + NODE_HEIGHT + NODE_GAP_Y + NODE_HEIGHT / 2)).toBe("b")
  })

  test("nearestInputPortId respects drag overrides when computing positions", () => {
    const graph = layoutWorkflowSteps([step("a", "cap.a"), step("b", "cap.b")])
    // Move a to x=999 so the cursor near (1000, PADDING + NODE_HEIGHT/2)
    // is closest to a, not b.
    const overrides = { a: { x: 999, y: PADDING } }
    expect(nearestInputPortId(graph, overrides, 1000, PADDING + NODE_HEIGHT / 2)).toBe("a")
  })

  test("closestInputPortDistance returns Infinity on an empty graph", () => {
    expect(closestInputPortDistance(layoutWorkflowSteps([]), {}, 0, 0)).toBe(Number.POSITIVE_INFINITY)
  })

  test("hasEdge detects an existing pair", () => {
    expect(hasEdge([{ from: "a", to: "b" }, { from: "b", to: "c" }], "a", "b")).toBe(true)
    expect(hasEdge([{ from: "a", to: "b" }], "b", "a")).toBe(false)
    expect(hasEdge([], "a", "b")).toBe(false)
  })
})
