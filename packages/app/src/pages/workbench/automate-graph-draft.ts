/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import type { UserEdge } from "./automate-graph-layout"
import type { WorkflowStepSummary } from "./automate-workflow-model"

// The runtime (`toIr` in workbench-server) executes `steps` only and always
// links them sequentially, so what the author draws (positions, extra edges,
// library nodes) lives beside `steps` under `ui`: the draft keeps it, the
// run ignores it. See docs/audit/EXECUTION-LOG-CORRECTIONS.md (T2).
export type ExtraNode = WorkflowStepSummary & { readonly family?: string }

export type GraphState = {
  readonly positions: Record<string, { readonly x: number; readonly y: number }>
  readonly edges: readonly UserEdge[]
  readonly extraNodes: readonly ExtraNode[]
}

export const EMPTY_GRAPH: GraphState = { positions: {}, edges: [], extraNodes: [] }

const UI_KEY = "ui"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number"
}

function isEdge(value: unknown): value is UserEdge {
  return isRecord(value) && typeof value.from === "string" && typeof value.to === "string"
}

function isExtraNode(value: unknown): value is ExtraNode {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string"
}

function parseRecord(source: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(source)
    return isRecord(raw) ? raw : undefined
  } catch {
    // WHY: a draft mid-edit in the JSON tab is often invalid; callers keep their current graph.
    return undefined
  }
}

/** Reads the drawn graph out of a draft; `undefined` when the text is not a JSON object. */
export function graphFromSource(source: string): GraphState | undefined {
  const raw = parseRecord(source)
  if (!raw) return undefined
  const ui = raw[UI_KEY]
  if (!isRecord(ui)) return EMPTY_GRAPH
  const positions: Record<string, { x: number; y: number }> = {}
  if (isRecord(ui.positions)) {
    for (const [id, point] of Object.entries(ui.positions)) if (isPoint(point)) positions[id] = { x: point.x, y: point.y }
  }
  return {
    positions,
    edges: Array.isArray(ui.edges) ? ui.edges.filter(isEdge) : [],
    extraNodes: Array.isArray(ui.extraNodes) ? ui.extraNodes.filter(isExtraNode) : [],
  }
}

function isEmptyGraph(graph: GraphState): boolean {
  return Object.keys(graph.positions).length === 0 && graph.edges.length === 0 && graph.extraNodes.length === 0
}

/** Writes the drawn graph into a draft, leaving every other field untouched. Invalid text is returned as is. */
export function sourceWithGraph(source: string, graph: GraphState): string {
  const raw = parseRecord(source)
  if (!raw) return source
  const { [UI_KEY]: _previous, ...rest } = raw
  const next = isEmptyGraph(graph)
    ? rest
    : { ...rest, [UI_KEY]: { positions: graph.positions, edges: graph.edges, extraNodes: graph.extraNodes } }
  return JSON.stringify(next, null, 2)
}

/** Steps the runtime receives: the file's steps, then the nodes added from the library. */
export function runnableSteps(steps: readonly unknown[], extraNodes: readonly ExtraNode[]): readonly unknown[] {
  return [
    ...steps,
    ...extraNodes.map((node) => ({
      id: node.id,
      family: node.family,
      config: {},
      ...(node.requiresApproval ? { requiresApproval: true } : {}),
    })),
  ]
}
