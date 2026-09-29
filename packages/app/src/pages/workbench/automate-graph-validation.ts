/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Pure graph-edge validation for the Automate studio.
 *
 * Phase 9 slice 2 (branches). The studio lets the author draw
 * labelled branch edges (`branch-true` / `branch-false`) out of a
 * `control.if` node - the same topology the runtime's graph
 * executor walks (packages/workflow-runtime/src/graph-runtime.ts).
 * This module is the editor-side guardrail that mirrors the
 * runtime's topology expectations:
 *
 * - no cycles: the IR has no raw-edge loop construct (loops are
 *   `control.repeat` / `control.while` body configs), so a cycle
 *   in the drawn graph can never execute.
 * - one edge per branch kind per source: the runtime matches
 *   `control.if` branches by edge kind, so two `branch-true`
 *   edges out of the same node are ambiguous.
 * - branch edges require a branching family: only `control.if`
 *   fans out into labelled branches today; a branch edge out of
 *   any other family would serialize a kind the runtime ignores.
 *
 * Pure: no I/O, no clock, deterministic order (input order wins),
 * so the unit tests pin the exact issue list.
 */
import { isBranchingFamily, type UserEdgeKind } from "./automate-graph-layout"

export type GraphNodeRef = { readonly id: string; readonly family?: string }

export type GraphEdgeRef = {
  readonly from: string
  readonly to: string
  readonly kind?: UserEdgeKind
}

export type GraphIssue =
  | { readonly code: "cycle"; readonly path: readonly string[] }
  | { readonly code: "duplicate-branch"; readonly from: string; readonly kind: UserEdgeKind }
  | { readonly code: "branch-from-non-branching"; readonly from: string; readonly kind: UserEdgeKind }

const BRANCH_KINDS: readonly UserEdgeKind[] = ["branch-true", "branch-false"]

/**
 * Validate the merged edge set (synthetic sequential edges + user
 * edges). Returns every issue in deterministic order: cycles
 * first (one, the first found in input order), then per-edge
 * branch issues in edge order.
 */
export function validateGraphEdges(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
): readonly GraphIssue[] {
  const issues: GraphIssue[] = []
  const cycle = findFirstCycle(edges)
  if (cycle) issues.push(cycle)
  const familyById = new Map(nodes.map((node) => [node.id, node.family]))
  const branchCounts = new Map<string, number>()
  for (const edge of edges) {
    const kind = edge.kind ?? "flow"
    if (!BRANCH_KINDS.includes(kind)) continue
    const key = `${edge.from}:${kind}`
    const count = (branchCounts.get(key) ?? 0) + 1
    branchCounts.set(key, count)
    if (count > 1) issues.push({ code: "duplicate-branch", from: edge.from, kind })
    const family = familyById.get(edge.from)
    if (family !== undefined && !isBranchingFamily(family)) {
      issues.push({ code: "branch-from-non-branching", from: edge.from, kind })
    }
  }
  return issues
}

/**
 * Depth-first search for the first cycle in the directed edge set.
 * Iterates edges in input order so the reported path is stable for
 * a given input (the unit tests rely on that determinism).
 */
function findFirstCycle(edges: readonly GraphEdgeRef[]): GraphIssue | undefined {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? []
    list.push(edge.to)
    adjacency.set(edge.from, list)
  }
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const stack: string[] = []
  const visit = (id: string): GraphIssue | undefined => {
    color.set(id, GRAY)
    stack.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const state = color.get(next) ?? WHITE
      if (state === GRAY) {
        const start = stack.indexOf(next)
        return { code: "cycle", path: [...stack.slice(start), next] }
      }
      if (state === WHITE) {
        const found = visit(next)
        if (found) return found
      }
    }
    stack.pop()
    color.set(id, BLACK)
    return undefined
  }
  for (const id of adjacency.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      const found = visit(id)
      if (found) return found
    }
  }
  return undefined
}