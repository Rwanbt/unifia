/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Pure helpers for parsing workflow definition files served by the
 * Workbench wire bridge.
 *
 * Extracted from `automate-surface.tsx` so the surface remains a thin
 * SolidJS view while the parsing logic becomes testable in plain Node
 * (no `useWorkspaceWorkbench` mock, no TanStack Query mock, no
 * SolidJS router — those are exercised in e2e).
 *
 * C-PRE1-01 phase 2: this extraction is the smallest refactor that
 * unblocks a real round-trip test for `decodeFile`. Behaviour is
 * preserved bit-for-bit; the only change is that the helper is now
 * importable from a sibling test file.
 *
 * Phase 8 slice 7: `parseCanonicalWorkflowDefinition` accepts both
 * the legacy v1 shape (auto-migrates via `migrateLegacyToCanonical`)
 * AND the canonical v2 shape (passes through). The legacy
 * `parseWorkflowDefinition` is unchanged so existing surface
 * consumers don't break.
 */

export { decodeWorkbenchFile as decodeFile, type WorkbenchFilePayload } from "@/context/workbench/file-content"
import { migrateLegacyToCanonical } from "./automate-migrate-legacy"
export { migrateLegacyToCanonical, type CanonicalWorkflowDefinition } from "./automate-migrate-legacy"

/**
 * Parses a JSON-encoded workflow definition body and validates the
 * minimum shape required by the current runtime. This is the surface
 * check that already exists in `automate-surface.tsx`; centralised here
 * so the error messages and the contract are testable, and so ADR-002
 * (WorkflowIR) can replace this with a strict Zod validator without
 * touching the surface.
 */
export type ParsedWorkflowDefinition = {
  readonly id: string
  readonly version: number
  readonly steps: readonly unknown[]
  readonly displayName?: string
  readonly description?: string
}

export type ParseWorkflowDefinitionResult =
  | { kind: "ok"; definition: ParsedWorkflowDefinition }
  | { kind: "error"; message: string }

export function parseWorkflowDefinition(json: string): ParseWorkflowDefinitionResult {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "invalid JSON" }
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) return { kind: "error", message: "id must be a non-empty string" }
  if (raw.version !== 1) return { kind: "error", message: "version must be exactly 1" }
  if (!Array.isArray(raw.steps)) return { kind: "error", message: "steps must be an array" }
  return { kind: "ok", definition: { id: raw.id, version: 1, steps: raw.steps } }
}

/**
 * Result of `parseCanonicalWorkflowDefinition`. Carries the
 * `originalVersion` so the surface can warn the user when the
 * file was auto-migrated from v1 → v2.
 */
export type ParseCanonicalResult =
  | { kind: "ok"; definition: import("./automate-migrate-legacy").CanonicalWorkflowDefinition; originalVersion: 1 | 2 }
  | { kind: "error"; message: string }

/**
 * Parses a workflow file and returns the canonical
 * `WorkflowDefinition {nodes, edges}` IR. Accepts both the
 * legacy v1 shape (auto-migrates) and the canonical v2 shape
 * (passes through). The `originalVersion` field lets the
 * surface warn the user when an old file has just been
 * migrated.
 */
export function parseCanonicalWorkflowDefinition(json: string): ParseCanonicalResult {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "invalid JSON" }
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return { kind: "error", message: "id must be a non-empty string" }
  }
  if (raw.version === 2) {
    if (!Array.isArray(raw.nodes)) return { kind: "error", message: "nodes must be an array (v2)" }
    if (!Array.isArray(raw.edges)) return { kind: "error", message: "edges must be an array (v2)" }
    const migrated = migrateLegacyToCanonical({
      id: raw.id,
      version: 1,
      displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      steps: [],
    } as ParsedWorkflowDefinition)
    return {
      kind: "ok",
      originalVersion: 2,
      definition: {
        ...migrated,
        nodes: raw.nodes as import("./automate-migrate-legacy").CanonicalWorkflowDefinition["nodes"],
        edges: raw.edges as import("./automate-migrate-legacy").CanonicalWorkflowDefinition["edges"],
      },
    }
  }
  if (raw.version === 1) {
    if (!Array.isArray(raw.steps)) return { kind: "error", message: "steps must be an array (v1)" }
    const legacy: ParsedWorkflowDefinition = {
      id: raw.id,
      version: 1,
      displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      steps: raw.steps,
    }
    return { kind: "ok", originalVersion: 1, definition: migrateLegacyToCanonical(legacy) }
  }
  return { kind: "error", message: `Unsupported version: ${JSON.stringify(raw.version)}` }
}

