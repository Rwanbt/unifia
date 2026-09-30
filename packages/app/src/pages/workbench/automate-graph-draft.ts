/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { isBranchingFamily, type UserEdge, type UserEdgeKind } from "./automate-graph-layout"
import type { WorkflowStepSummary } from "./automate-workflow-model"

// What the author draws (positions, extra edges, library nodes) lives beside
// `steps` under `ui`: the draft keeps it. At run time the drawn edges are sent
// as `edges` (runnableEdges) so the runtime executes the graph as drawn; with
// no drawn edge the runtime keeps its sequential chain over `steps` (CR04).
export type ExtraNode = WorkflowStepSummary & {
  readonly family?: string
  /** Author-edited family settings (control.if condition, control.merge strategy). */
  readonly config?: Readonly<Record<string, unknown>>
}

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

/**
 * Runtime config of a library node. A merge waits on whatever was drawn into
 * it, so its branch list is derived from the edges, never typed twice.
 */
export function runnableConfig(node: ExtraNode, drawn: readonly UserEdge[]): Record<string, unknown> {
  if (node.family === "control.if") {
    return { condition: typeof node.config?.condition === "string" ? node.config.condition : "" }
  }
  if (node.family === "control.merge") {
    const strategy = node.config?.strategy === "any" ? "any" : "all"
    return { strategy, branches: [...new Set(drawn.filter((edge) => edge.to === node.id).map((edge) => edge.from))] }
  }
  return {}
}

/** Steps the runtime receives: the file's steps, then the nodes added from the library. */
export function runnableSteps(
  steps: readonly unknown[],
  extraNodes: readonly ExtraNode[],
  drawn: readonly UserEdge[] = [],
): readonly unknown[] {
  return [
    ...steps,
    ...extraNodes.map((node) => ({
      id: node.id,
      family: node.family,
      config: runnableConfig(node, drawn),
      ...(node.requiresApproval ? { requiresApproval: true } : {}),
    })),
  ]
}

export type RunnableEdge = { readonly from: string; readonly to: string; readonly kind: UserEdgeKind }

function stepIdOf(step: unknown): string | undefined {
  return isRecord(step) && typeof step.id === "string" ? step.id : undefined
}

function stepFamilyOf(step: unknown): string | undefined {
  return isRecord(step) && typeof step.family === "string" ? step.family : undefined
}

/**
 * Edges the runtime receives, or undefined when nothing was drawn (the runtime
 * then chains `steps` in order, as it always did). Once the author draws an
 * edge, the drawing is the topology: a step with a drawn output keeps only
 * what was drawn from it, a branching step gets no implicit link, and every
 * other step keeps its default link to the next file step.
 */
export function runnableEdges(
  steps: readonly unknown[],
  extraNodes: readonly ExtraNode[],
  drawn: readonly UserEdge[],
): readonly RunnableEdge[] | undefined {
  if (drawn.length === 0) return undefined
  const fileIds = steps.map(stepIdOf).filter((id): id is string => id !== undefined)
  const known = new Set([...fileIds, ...extraNodes.map((node) => node.id)])
  const usable = drawn.filter((edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to)
  const drawnFrom = new Set(usable.map((edge) => edge.from))
  const edges: RunnableEdge[] = []
  const seen = new Set<string>()
  const add = (edge: RunnableEdge) => {
    const key = `${edge.from}>${edge.to}:${edge.kind}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push(edge)
  }
  for (let index = 0; index < steps.length - 1; index++) {
    const from = stepIdOf(steps[index])
    const to = stepIdOf(steps[index + 1])
    if (from === undefined || to === undefined) continue
    if (drawnFrom.has(from) || isBranchingFamily(stepFamilyOf(steps[index]))) continue
    add({ from, to, kind: "flow" })
  }
  for (const edge of usable) add({ from: edge.from, to: edge.to, kind: edge.kind ?? "flow" })
  return edges
}
