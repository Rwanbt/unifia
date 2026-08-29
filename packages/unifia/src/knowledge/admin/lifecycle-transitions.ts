/* SPDX-License-Identifier: MIT */
/**
 * Lifecycle transitions matrix (P11.51).
 *
 * Exposes the V1 lifecycle state transition table (per
 * ADR-KNOW-0009) as a structured data + a printable matrix.
 * The matrix is `from -> to: true/false` for every pair.
 *
 * Pure / read-only. No vault walks, no I/O.
 *
 * V1 states: candidate, active, superseded, archived.
 */

import type { KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

const V1_LIFECYCLES: readonly KnowledgeLifecycleState[] = [
  "candidate",
  "active",
  "superseded",
  "archived",
]

/** Allowed transitions (ADR-KNOW-0009). */
const ALLOWED: Record<KnowledgeLifecycleState, KnowledgeLifecycleState[]> = {
  candidate: ["active", "archived"],
  active: ["superseded", "archived"],
  superseded: ["active", "archived"],
  archived: ["active"],
}

export type TransitionMatrix = Record<KnowledgeLifecycleState, Record<KnowledgeLifecycleState, boolean>>

export function buildTransitionMatrix(): TransitionMatrix {
  const m = {} as TransitionMatrix
  for (const from of V1_LIFECYCLES) {
    const row = {} as Record<KnowledgeLifecycleState, boolean>
    for (const to of V1_LIFECYCLES) {
      row[to] = ALLOWED[from].includes(to)
    }
    m[from] = row
  }
  return m
}

export function isTransitionAllowed(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): boolean {
  return ALLOWED[from].includes(to)
}

export function getAllowedTransitions(from: KnowledgeLifecycleState): KnowledgeLifecycleState[] {
  return [...ALLOWED[from]]
}

export function getV1Lifecycles(): readonly KnowledgeLifecycleState[] {
  return V1_LIFECYCLES
}

export function formatTransitionMatrix(m: TransitionMatrix): string {
  const lcs = Object.keys(m) as KnowledgeLifecycleState[]
  const colW = 13
  const header = ["          "].concat(lcs.map((l) => l.padEnd(colW)))
  const lines: string[] = []
  lines.push(header.join(" "))
  for (const from of lcs) {
    const row = [from.padEnd(10)]
    for (const to of lcs) {
      const cell = m[from][to] ? "OK" : "  -"
      row.push(cell.padEnd(colW))
    }
    lines.push(row.join(" "))
  }
  return lines.join("\n")
}
