/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * V1 → V2 IR mapping. Per ADR-017 §70-84 + plan V2.3.1 §182-185 +
 * §222-223.
 *
 * The mapping is **pure** and **deterministic** — given a V1 fixture,
 * the same V2 WorkflowDefinition comes out, every time. That property
 * is what makes the migration CI (plan §185) testable: a V1 fixture
 * is replayed, the migrator runs, the result is parsed by V2 spec, and
 * the parsed V2 WorkflowDefinition is compared to a known-good V2
 * expectation. No floats, no timestamps, no `Math.random`.
 *
 * The mapping is also **lossy on purpose** where V2 cannot express
 * V1 semantics faithfully. Those losses are returned in a
 * `MigrationWarning` so the operator can decide whether to:
 *   (a) accept the warning and proceed,
 *   (b) fix the V1 fixture by hand and re-migrate, or
 *   (c) fall back to the `finish legacy` / `cancel + restart V2`
 *       strategies listed in ADR-017 §60-66.
 *
 * The mapping is **not** the V2 runtime. The runtime (parses the
 * V2 IR, runs the durable execution, talks to substrate) is the
 * `WorkflowRuntime` (M1-09) and remains blocked by ADR-000. What
 * we produce here is a structurally valid V2 IR; the consumer is
 * expected to call `z.parse(WorkflowDefinitionSchema, result)` to
 * confirm.
 */

import { V1_GLOBAL_DEFAULTS, type V1Step, type V1WorkflowDefinition } from "./v1-ir.ts"
import type {
  V2Edge,
  V2FailurePolicy,
  V2Node,
  V2NodeFamily,
  V2OwnershipScope,
  V2WorkflowDefinition,
} from "./v2-ir.ts"

/**
 * Severity of a migration warning. `info` is acceptable to ship; `warn`
 * should be reviewed by an operator; `block` refuses the migration.
 */
export type MigrationWarningSeverity = "info" | "warn" | "block"

export interface MigrationWarning {
  severity: MigrationWarningSeverity
  /** V1 step id (or "*" for whole-workflow). */
  stepId: string
  /** Stable warning code, e.g. `v1-unsupported-capability`. */
  code: string
  message: string
}

export interface MigrationResult {
  definition: V2WorkflowDefinition
  warnings: ReadonlyArray<MigrationWarning>
}

/**
 * The V1 `capability` discriminator → V2 `NodeFamily` mapping table.
 * Anything outside this table is reported as `v1-unsupported-capability`
 * and blocks the migration. New V1 capabilities must be added here
 * explicitly; this is intentional (no `default`).
 */
const V1_CAPABILITY_TO_V2_FAMILY: Readonly<Record<string, V2NodeFamily>> = {
  http: "tool.http",
  approval: "human.approval",
  wait: "wait",
  schedule: "trigger.schedule",
  manual: "trigger.manual",
}

/**
 * V1 had no explicit trigger node. The migrator picks a sensible
 * default based on the first step's capability, with a `warn` if the
 * choice is not obvious.
 */
function inferV2Trigger(v1: V1WorkflowDefinition): { family: V2NodeFamily; warning?: MigrationWarning } {
  if (v1.steps.length === 0) {
    return {
      family: "trigger.manual",
      warning: {
        severity: "warn",
        stepId: "*",
        code: "v1-no-steps",
        message: "V1 workflow has no steps; default trigger is `trigger.manual`.",
      },
    }
  }
  const first = v1.steps[0]!
  if (first.capability === "schedule") {
    return { family: "trigger.schedule" }
  }
  if (first.capability === "manual") {
    return { family: "trigger.manual" }
  }
  return {
    family: "trigger.manual",
    warning: {
      severity: "info",
      stepId: first.id,
      code: "v1-default-trigger",
      message: `First step capability is \`${first.capability}\`; defaulting to \`trigger.manual\`.`,
    },
  }
}

/**
 * Convert a V1 step into one or more V2 nodes. The +1 case is
 * `requiresApproval: true`, which inserts a `human.approval` node
 * immediately before the step's main node, with a `flow` edge.
 */
function v1StepToV2Nodes(step: V1Step): { nodes: V2Node[]; edges: V2Edge[]; warnings: MigrationWarning[] } {
  const warnings: MigrationWarning[] = []
  const family = V1_CAPABILITY_TO_V2_FAMILY[step.capability]
  if (family === undefined) {
    warnings.push({
      severity: "block",
      stepId: step.id,
      code: "v1-unsupported-capability",
      message: `V1 capability \`${step.capability}\` has no V2 mapping.`,
    })
    return { nodes: [], edges: [], warnings }
  }

  // `shell` and `openapi` are explicitly NOT in the table. They were
  // V1 features that the V2 IR reuses via the V1 capability → V2
  // family mapping; if a V1 fixture uses them, the migrator must
  // either upgrade the V2 IR to include them or be told to skip.
  // For now they are `v1-unsupported-capability`.

  const nodes: V2Node[] = []
  const edges: V2Edge[] = []

  if (step.requiresApproval) {
    // Insert a `human.approval` gate. The approval node id is derived
    // deterministically from the step id so a re-migration is stable.
    const approvalNodeId = `${step.id}__approval`
    nodes.push({
      id: approvalNodeId,
      family: "human.approval",
      config: { reason: `V1 step ${step.id} had requiresApproval=true` },
      label: `Approve ${step.id}`,
    })
    nodes.push({
      id: step.id,
      family,
      config: { input: step.input },
      label: step.id,
    })
    edges.push({ from: approvalNodeId, to: step.id, kind: "flow" })
  } else {
    nodes.push({
      id: step.id,
      family,
      config: { input: step.input },
      label: step.id,
    })
  }

  return { nodes, edges, warnings }
}

/**
 * Build the V2 ownership scope. V1 had `workspaceId` only; the V2
 * scope requires `workspaceId` + `ownerId`. The migrator fills
 * `ownerId` with the literal string `v1-migration` and adds a
 * `warn` so the operator knows to update it.
 */
function buildV2OwnershipScope(v1: V1WorkflowDefinition, warnings: MigrationWarning[]): V2OwnershipScope {
  warnings.push({
    severity: "warn",
    stepId: "*",
    code: "v1-default-owner",
    message: "V1 fixtures had no `ownerId`; defaulting to `v1-migration`. Operator should update before cutover.",
  })
  return {
    workspaceId: v1.workspaceId,
    ownerId: "v1-migration",
  }
}

/**
 * Build the V2 failure + concurrency policies from V1 globals. V1
 * was a single-attempt, no-backoff system. V2 surfaces that as
 * `maxAttempts: 1, backoff: none`.
 */
function buildV2Policies(): { concurrency: V2WorkflowDefinition["concurrency"]; defaultFailurePolicy: V2FailurePolicy } {
  return {
    concurrency: {
      strategy: V1_GLOBAL_DEFAULTS.concurrency,
    },
    defaultFailurePolicy: {
      maxAttempts: V1_GLOBAL_DEFAULTS.maxAttempts,
      backoff: V1_GLOBAL_DEFAULTS.backoff,
      retryOn: [],
    },
  }
}

/**
 * The deterministic V1 → V2 mapping. Pures id-generation, no
 * timestamps in the IR content (`createdAt` / `updatedAt` are passed
 * in by the caller so CI can pin them; the migrator itself does not
 * consult the wall clock).
 */
export function migrateV1ToV2(
  v1: V1WorkflowDefinition,
  options: { createdAt: number; updatedAt: number },
): MigrationResult {
  const warnings: MigrationWarning[] = []

  const trigger = inferV2Trigger(v1)
  if (trigger.warning) warnings.push(trigger.warning)

  const allNodes: V2Node[] = [
    {
      id: `${v1.id}__trigger`,
      family: trigger.family,
      config: {},
      label: "trigger",
    },
  ]
  const allEdges: V2Edge[] = []

  // Connect trigger to the first step (or first approval node).
  let prevId = `${v1.id}__trigger`
  for (const step of v1.steps) {
    const { nodes, edges, warnings: stepWarnings } = v1StepToV2Nodes(step)
    warnings.push(...stepWarnings)
    if (stepWarnings.some((w) => w.severity === "block")) {
      // Short-circuit: a blocking warning aborts the rest of the
      // mapping because the produced IR would be incomplete.
      break
    }
    if (nodes.length === 0) continue
    const firstId = nodes[0]!.id
    allEdges.push({ from: prevId, to: firstId, kind: "flow" })
    for (const e of edges) allEdges.push(e)
    for (const n of nodes) allNodes.push(n)
    prevId = nodes[nodes.length - 1]!.id
  }

  const { concurrency, defaultFailurePolicy } = buildV2Policies()
  const ownershipScope = buildV2OwnershipScope(v1, warnings)

  const definition: V2WorkflowDefinition = {
    definitionId: v1.id,
    ownershipScope,
    displayName: v1.id,
    description: `Migrated from V1 fixture (workspaceId=${v1.workspaceId}, version=${String(v1.version)})`,
    nodes: allNodes,
    edges: allEdges,
    concurrency,
    defaultFailurePolicy,
    defaultTimeoutMs: 30_000,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
  }

  return { definition, warnings }
}

/**
 * Predicate used by the migration CI gate. A migration result is
 * `acceptable` if no warning has `severity: "block"`. `warn` and
 * `info` are still shippable.
 */
export function isAcceptableMigration(result: MigrationResult): boolean {
  return !result.warnings.some((w) => w.severity === "block")
}
