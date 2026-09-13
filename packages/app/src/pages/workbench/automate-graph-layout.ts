/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Pure layout for the Automate studio canvas.
 *
 * The current on-disk workflow format is a *sequential* list of steps
 * (legacy `WorkflowDefinition {id, version, steps[]}`). The studio
 * visualizes it as a left-to-right node graph: one node per step, one
 * arrow between consecutive steps. Positions are deterministic and
 * derived from the input order — no randomness, no time, no DOM. The
 * function is the canonical source of truth for the canvas geometry;
 * the SolidJS component reads its output and renders SVG.
 *
 * Constraints kept in mind (M3 anti-regression, AGENTS.md):
 * - Pure (no I/O, no clock, no crypto, no `Date.now()`). The unit
 *   tests pin the output byte-for-byte.
 * - Width fits content; the canvas wraps an inner `<g>` and uses
 *   `transform` for pan/zoom, so the canvas itself can be any size.
 * - Read-only. Phase 8 first slice visualizes the workflow; editing
 *   (drag-to-move, connect-port) is a separate slice.
 */
import type { WorkflowStepSummary } from "./automate-workflow-model"

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 80
export const NODE_GAP_X = 64
export const NODE_GAP_Y = 48
export const PADDING = 24

export type LaidOutNode = {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly label: string
  readonly family: string | undefined
  readonly requiresApproval: boolean
}

export type LaidOutEdge = {
  readonly from: string
  readonly to: string
  /** Source/target rectangle center-Y (used by the SVG bezier path). */
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export type LaidOutGraph = {
  readonly nodes: readonly LaidOutNode[]
  readonly edges: readonly LaidOutEdge[]
  /** Total bounding-box of the laid-out graph, in graph coordinates. */
  readonly width: number
  readonly height: number
}

export type NodePositionOverride = { readonly x: number; readonly y: number }

export type UserEdge = { readonly from: string; readonly to: string }

export type EdgeEndpoint = {
  readonly from: string
  readonly to: string
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  /** True when the edge came from the parent's `edges` prop (i.e. user-added). Synthetic sequential edges from the layout are not marked. */
  readonly user: boolean
}

/**
 * Recompute the edge endpoints from the current effective node
 * positions. Pure: takes the laid-out graph + the user override map
 * + the user-added edges and returns one endpoint set per edge.
 * Synthetic edges (from `graph.edges`) and user edges (from
 * `userEdges`) are merged. When a node has been dragged (slice 3 of
 * Phase 8), the bezier follows it instead of snapping back to the
 * deterministic layout. The function lives next to
 * `layoutWorkflowSteps` because both functions describe the same
 * graph geometry, just at different lifecycle stages (initial layout
 * vs. live drag override vs. user-added connections).
 */
export function mergeEndpoints(
  graph: LaidOutGraph,
  overrides: Readonly<Record<string, NodePositionOverride>>,
  userEdges: readonly UserEdge[],
): readonly EdgeEndpoint[] {
  const synthetic = graph.edges.map((edge) => endpointFor(edge.from, edge.to, graph, overrides, false))
  const user = userEdges.map((edge) => endpointFor(edge.from, edge.to, graph, overrides, true))
  return [...synthetic, ...user]
}

/**
 * Single-edge endpoint helper. Returns the layout value when the
 * edge references an unknown node (defensive — keeps the canvas from
 * crashing if the workflow file is malformed).
 */
function endpointFor(
  fromId: string,
  toId: string,
  graph: LaidOutGraph,
  overrides: Readonly<Record<string, NodePositionOverride>>,
  user: boolean,
): EdgeEndpoint {
  const fromNode = graph.nodes.find((node) => node.id === fromId)
  const toNode = graph.nodes.find((node) => node.id === toId)
  if (!fromNode || !toNode) {
    return { from: fromId, to: toId, x1: 0, y1: 0, x2: 0, y2: 0, user }
  }
  const fromOverride = overrides[fromId]
  const toOverride = overrides[toId]
  const fromX = fromOverride?.x ?? fromNode.x
  const fromY = fromOverride?.y ?? fromNode.y
  const toX = toOverride?.x ?? toNode.x
  const toY = toOverride?.y ?? toNode.y
  return {
    from: fromId,
    to: toId,
    x1: fromX + fromNode.width,
    y1: fromY + fromNode.height / 2,
    x2: toX,
    y2: toY + toNode.height / 2,
    user,
  }
}

/**
 * Distance between a candidate point (cx, cy) and the closest input
 * port of any node in the graph, expressed in graph units. The
 * caller compares the result to a hit-test radius (see
 * `PORT_HIT_RADIUS`). Returns `Infinity` when the graph is empty.
 */
export function closestInputPortDistance(
  graph: LaidOutGraph,
  overrides: Readonly<Record<string, NodePositionOverride>>,
  cx: number,
  cy: number,
): number {
  let best = Number.POSITIVE_INFINITY
  for (const node of graph.nodes) {
    const x = (overrides[node.id]?.x ?? node.x)
    const y = (overrides[node.id]?.y ?? node.y) + node.height / 2
    const dx = cx - x
    const dy = cy - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < best) best = dist
  }
  return best
}

/**
 * Id of the input port closest to (cx, cy), or undefined when the
 * graph is empty. Pure function — used by the canvas to commit a
 * new edge after the user releases a port-to-port drag.
 */
export function nearestInputPortId(
  graph: LaidOutGraph,
  overrides: Readonly<Record<string, NodePositionOverride>>,
  cx: number,
  cy: number,
): string | undefined {
  let best: { id: string; dist: number } | undefined
  for (const node of graph.nodes) {
    const x = (overrides[node.id]?.x ?? node.x)
    const y = (overrides[node.id]?.y ?? node.y) + node.height / 2
    const dx = cx - x
    const dy = cy - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (!best || dist < best.dist) best = { id: node.id, dist }
  }
  return best?.id
}

/**
 * O(n) membership test on the user-controlled edge list. Used by the
 * canvas to skip committing a duplicate edge on port-to-port drop.
 */
export function hasEdge(edges: readonly UserEdge[], from: string, to: string): boolean {
  return edges.some((edge) => edge.from === from && edge.to === to)
}

/**
 * Hit-test radius for the drag-port-to-port gesture, in graph units.
 * Tuned so the user can drop on a port without pixel-perfect aim;
 * the value matches the rendered port circle radius (PORT_RADIUS in
 * the canvas) plus a 6-unit safety margin.
 */
export const PORT_HIT_RADIUS = 12

/**
 * Visual port radius (canvas only). Exported so the hit-test radius
 * stays in lockstep with the rendered circle.
 */
export const PORT_RADIUS = 6

/**
 * Slice 8.9: zoom-to-fit math. Given the laid-out graph's bounding
 * box and the canvas viewport size (in CSS pixels), compute the
 * pan + zoom that centres the graph and fits it with a small
 * margin. Pure function — easy to unit-test in plain Node.
 *
 * `viewportPadding` defaults to 24 CSS pixels (matches the canvas
 * wrapper padding). Caller clamps the returned zoom to the
 * existing MIN_ZOOM / MAX_ZOOM range if it has to remain
 * user-zoomable.
 */
export function computeZoomToFit(
  graph: LaidOutGraph,
  viewportWidth: number,
  viewportHeight: number,
  viewportPadding = 24,
): { readonly panX: number; readonly panY: number; readonly zoom: number } {
  if (graph.nodes.length === 0) return { panX: 0, panY: 0, zoom: 1 }
  const innerWidth = Math.max(0, viewportWidth - viewportPadding * 2)
  const innerHeight = Math.max(0, viewportHeight - viewportPadding * 2)
  if (innerWidth === 0 || innerHeight === 0) return { panX: 0, panY: 0, zoom: 1 }
  const zoom = Math.min(innerWidth / graph.width, innerHeight / graph.height)
  const renderedWidth = graph.width * zoom
  const renderedHeight = graph.height * zoom
  // Centre the rendered graph in the viewport.
  const panX = (viewportWidth - renderedWidth) / 2
  const panY = (viewportHeight - renderedHeight) / 2
  return { panX, panY, zoom }
}

/**
 * Compute deterministic positions and edges for a sequential step list.
 *
 * Algorithm: one column per step, stacked top-to-bottom (so a long
 * workflow scrolls vertically inside the canvas pane rather than
 * spilling horizontally past a typical 5xl container). Each step gets
 * a fixed `NODE_WIDTH × NODE_HEIGHT` card; the column header is empty
 * (the step id is rendered inside the card, not above it). The
 * resulting `width`/`height` are the canvas bounds; the SolidJS
 * component places an inner `<g transform="translate(panX,panY)
 * scale(zoom)">` and lets CSS scroll/overflow handle the rest.
 *
 * Slice 5: when `extraNodes` are passed (slice 8.5 node library),
 * they extend the vertical stack after the legacy steps. Sequential
 * edges connect each consecutive pair across the boundary so the
 * canvas renders one continuous flow.
 */
export function layoutWorkflowSteps(
  steps: readonly WorkflowStepSummary[],
  extraNodes: readonly WorkflowStepSummary[] = [],
): LaidOutGraph {
  const nodes: LaidOutNode[] = []
  const edges: LaidOutEdge[] = []
  const all = [...steps, ...extraNodes]
  all.forEach((step, index) => {
    const y = PADDING + index * (NODE_HEIGHT + NODE_GAP_Y)
    const currentNode: LaidOutNode = {
      id: step.id,
      x: PADDING,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      label: step.label,
      family: step.family,
      requiresApproval: step.requiresApproval,
    }
    nodes.push(currentNode)
    if (index > 0) {
      const previous = nodes[index - 1]
      edges.push({
        from: previous.id,
        to: step.id,
        x1: previous.x + previous.width,
        y1: previous.y + previous.height / 2,
        x2: currentNode.x,
        y2: currentNode.y + currentNode.height / 2,
      })
    }
  })
  const width = nodes.length === 0 ? 0 : PADDING * 2 + NODE_WIDTH
  const height =
    nodes.length === 0 ? 0 : PADDING * 2 + nodes.length * NODE_HEIGHT + (nodes.length - 1) * NODE_GAP_Y
  return { nodes, edges, width, height }
}
