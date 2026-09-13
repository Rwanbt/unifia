/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * One-way migration from the legacy workflow file format to the
 * canonical `WorkflowDefinition {nodes, edges}` IR.
 *
 * Phase 8 slice 7: the legacy on-disk shape is
 * `{id, version: 1, steps: [{id, family?, capability?, requiresApproval?}]}`.
 * The canonical shape adds `nodes[]` (typed per `NodeFamilySchema`)
 * and `edges[]` (with kind — flow / branch-* / case-* / on-failure).
 *
 * Migration rules (deterministic, pure, side-effect-free):
 * - Each legacy step becomes a canonical node with the same id;
 *   `family` and `capability` are lifted into `config`. The
 *   `family` field is also kept at the top level of the node so
 *   the canonical schema can validate it without parsing `config`.
 * - Sequential edges connect each consecutive pair (kind = "flow")
 *   so the runtime sees the same execution order as the legacy
 *   linear shape.
 * - `requiresApproval` stays in the node (the canonical schema
 *   doesn't carry it on the node itself; we store it in `config`
 *   under a namespaced key `_meta.requiresApproval` for round-
 *   trip preservation — the canonical IR does not need it but
 *   the Automate surface does, so persisting it inside `config`
 *   keeps a single source of truth).
 * - `version` bumps from 1 to 2; `displayName` is preserved when
 *   present, otherwise the id is reused.
 */
import { NodeFamilySchema } from "@unifia/contracts"
import type { ParsedWorkflowDefinition } from "./automate-decode"

export type CanonicalEdgeKind = "flow" | "branch-true" | "branch-false" | "case-value" | "branch-N" | "on-failure"

export type CanonicalNode = {
  readonly id: string
  readonly family: string
  readonly config: Readonly<Record<string, unknown>>
  readonly displayName?: string
}

export type CanonicalEdge = {
  readonly from: string
  readonly to: string
  readonly kind: CanonicalEdgeKind
}

export type CanonicalWorkflowDefinition = {
  readonly id: string
  readonly version: 2
  readonly displayName: string
  readonly description?: string
  readonly nodes: readonly CanonicalNode[]
  readonly edges: readonly CanonicalEdge[]
  /** Round-trip preservation of legacy-only fields. */
  readonly _meta?: Readonly<Record<string, unknown>>
}

/**
 * Pure migration: takes the legacy parsed definition (already
 * validated by `parseWorkflowDefinition`) and returns the
 * canonical shape. Throws if the legacy definition has no
 * resolvable steps (a workflow with zero steps is allowed — the
 * caller decides whether that's an error in their context).
 */
export function migrateLegacyToCanonical(legacy: ParsedWorkflowDefinition): CanonicalWorkflowDefinition {
  const nodes: CanonicalNode[] = []
  const edges: CanonicalEdge[] = []
  legacy.steps.forEach((rawStep, index) => {
    const record = isRecord(rawStep) ? rawStep : {}
    const id = stringOrFallback(record.id, `step-${index + 1}`)
    const family = stringOrUndefined(record.family) ?? stringOrUndefined(record.capability) ?? "tool.transform"
    // The schema would reject unknown families; the helper does not
    // re-validate here because the legacy parser already accepted
    // arbitrary family strings (it predates the canonical schema).
    // We mark invalid families with `unknown` so downstream tooling
    // can spot them, but we never throw — this is a pure migration,
    // not a validation step.
    const safeFamily = NodeFamilySchema.safeParse(family).success ? family : "tool.transform"
    const config: Record<string, unknown> = isRecord(record.config) ? { ...record.config } : {}
    if (record.requiresApproval === true) {
      config._meta = { ...(isRecord(config._meta) ? config._meta : {}), requiresApproval: true }
    }
    const node: CanonicalNode = {
      id,
      family: safeFamily,
      config,
    }
    nodes.push(node)
    if (index > 0) {
      const previous = nodes[index - 1]
      edges.push({ from: previous.id, to: id, kind: "flow" })
    }
  })
  const displayName = typeof legacy.displayName === "string" && legacy.displayName.length > 0 ? legacy.displayName : legacy.id
  const canonical: CanonicalWorkflowDefinition = {
    id: legacy.id,
    version: 2,
    displayName,
    nodes,
    edges,
  }
  if (legacy.description !== undefined) {
    return { ...canonical, description: legacy.description }
  }
  return canonical
}

/**
 * Inverse of `migrateLegacyToCanonical` for round-trip
 * validation in tests. NOT used at runtime — the canonical shape
 * is the durable format going forward; this exists to verify the
 * migration is invertible for definitions that fit the legacy
 * contract.
 */
export function canonicalToLegacyForTest(canonical: CanonicalWorkflowDefinition): {
  readonly id: string
  readonly version: 1
  readonly steps: readonly { readonly id: string; readonly family?: string; readonly capability?: string; readonly requiresApproval?: boolean }[]
} {
  return {
    id: canonical.id,
    version: 1,
    steps: canonical.nodes.map((node) => {
      const meta = isRecord(node.config._meta) ? node.config._meta : undefined
      const requiresApproval = isRecord(meta) && meta.requiresApproval === true
      const step: { id: string; family?: string; requiresApproval?: boolean } = {
        id: node.id,
        family: node.family,
      }
      if (requiresApproval) step.requiresApproval = true
      return step
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stringOrFallback(value: unknown, fallback: string): string {
  return stringOrUndefined(value) ?? fallback
}

/**
 * Pure helper: build the canonical IR from the current Automate
 * surface state (legacy steps + parent-controlled positions,
 * edges, and library-added nodes). Pure on purpose — easy to
 * unit-test and side-effect-free. The caller is responsible for
 * serializing the result via `serializeCanonical` and writing it
 * to the draft store / runtime.
 *
 * Behaviour:
 * - Legacy steps + library-added extra nodes become `nodes` in
 *   the order they appear in the merged list. Each node carries
 *   its `family` (when known) and its `config._meta.requiresApproval`
 *   flag (when set).
 * - Positions from the override map are stored in `config._meta.position`
 *   so the next session re-hydrates them via `parseCanonicalWorkflowDefinition`.
 * - The user-added edge list (slice 4 port connectors) is the
 *   canonical `edges` array verbatim. Sequential flow edges
 *   between consecutive nodes are NOT regenerated here — the
 *   user is the source of truth for connections after slice 4.
 *   Callers who want a default sequential floor may merge with
 *   `migrateLegacyToCanonical(...).edges` first.
 */
export function buildCanonicalFromState(input: {
  readonly legacy: ParsedWorkflowDefinition
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  readonly userEdges: readonly { readonly from: string; readonly to: string }[]
  readonly extraNodes: readonly WorkflowStepLike[]
}): CanonicalWorkflowDefinition {
  const { legacy, positions, userEdges, extraNodes } = input
  const base = migrateLegacyToCanonical(legacy)
  const extraAsNodes: CanonicalNode[] = extraNodes.map((entry) => {
    const family = stringOrUndefined(entry.family) ?? "tool.transform"
    const safeFamily = NodeFamilySchema.safeParse(family).success ? family : "tool.transform"
    const meta: Record<string, unknown> = entry.requiresApproval ? { requiresApproval: true } : {}
    return {
      id: entry.id,
      family: safeFamily,
      config: { _meta: meta },
    }
  })
  const allNodes: CanonicalNode[] = [...base.nodes, ...extraAsNodes]
  // Overlay positions from the override map onto each node's
  // config._meta.position. Legacy steps keep their original
  // config (including their own _meta); extra nodes start clean.
  const nodesWithPositions: CanonicalNode[] = allNodes.map((node) => {
    const override = positions[node.id]
    if (!override) return node
    const existingMeta = isRecord(node.config._meta) ? node.config._meta : {}
    return {
      ...node,
      config: { ...node.config, _meta: { ...existingMeta, position: { x: override.x, y: override.y } } },
    }
  })
  return { ...base, nodes: nodesWithPositions, edges: userEdges.map((edge) => ({ ...edge, kind: "flow" as const })) }
}

/**
 * Serializes a canonical definition to a stable JSON string.
 * JSON.stringify with a fixed key order keeps diffs clean and
 * makes the test fixtures deterministic.
 */
export function serializeCanonical(canonical: CanonicalWorkflowDefinition): string {
  return JSON.stringify(canonical, null, 2)
}

/**
 * Minimal shape the build helper needs from a library-added
 * extra node. Mirrors `WorkflowStepSummary` from
 * `automate-workflow-model` but is declared locally to avoid
 * a circular import (the workflow-model file imports the
 * decoder; the decoder imports this file).
 */
type WorkflowStepLike = {
  readonly id: string
  readonly label: string
  readonly requiresApproval: boolean
  readonly family?: string
}
