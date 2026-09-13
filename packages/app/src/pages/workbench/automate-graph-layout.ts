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
 */
export function layoutWorkflowSteps(steps: readonly WorkflowStepSummary[]): LaidOutGraph {
  const nodes: LaidOutNode[] = []
  const edges: LaidOutEdge[] = []
  steps.forEach((step, index) => {
    const y = PADDING + index * (NODE_HEIGHT + NODE_GAP_Y)
    const currentNode: LaidOutNode = {
      id: step.id,
      x: PADDING,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      label: step.label,
      family: undefined,
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
