/* SPDX-License-Identifier: MIT */
/**
 * Workflow IR (intermediate representation) — Plan V2.3.1 §55, ADR-002.
 *
 * The IR is the canonical, content-addressed form a workflow is
 * serialized into for storage, transport, and canonicalization
 * (Plan V2.3.1 §64, ADR-001). A WorkflowDefinition is what an author
 * edits; the runtime promotes it to one or more immutable
 * WorkflowVersion snapshots, each identified by a content digest
 * over the canonical JCS-v1 bytes.
 *
 * First target (ADR-002 Option A) is six node families — three
 * triggers, two effectors, one control. The IR is *intentionally*
 * closed: extending it requires a new family, a new version, and an
 * ADR. We do not let users bolt on ad-hoc node kinds.
 *
 * DigestDomainSchema lives in `digest.ts` to avoid a circular import
 * (this file re-exports it for callers that import from here).
 */
import { z } from "zod"
import { OwnershipScopeSchema, DeploymentScopeSchema } from "./scope.js"
import {
  DigestEnvelopeSchema,
  DigestDomainSchema,
  WorkflowVersionDigestSchema,
  type DigestDomain,
} from "./digest.js"
import { OverlapPolicySchema, CatchUpPolicySchema } from "./timer.js"

// Re-export so callers that import from this file still see DigestDomainSchema
// next to WorkflowIRSchema. The authoritative definition lives in digest.ts.
export { DigestDomainSchema }
export type { DigestDomain }

/* ------------------------------------------------------------------ */
/* Node families (ADR-002 Option A)                                    */
/* ------------------------------------------------------------------ */

/**
 * The node families in this IR version. The dotted form
 * (`family.verb`) is preserved as a literal string so the IR is
 * self-describing in logs and on the wire.
 *
 * The list grows additively with each M2 GREEN card (ADR-002
 * Option A): a new family, a new version, and an ADR. We do not
 * let users bolt on ad-hoc node kinds. The order is stable:
 * triggers first, then control flow, then effectors, then
 * orchestration. M2-03 (parallel) is inserted between `control.if`
 * and `tool.http`; the M2-02 worker will place `control.switch`
 * between `control.if` and `control.parallel`.
 */
export const NodeFamilySchema = z.enum([
  "trigger.manual",
  "trigger.schedule",
  "control.if",
  "control.parallel",
  "tool.http",
  "human.approval",
  "wait",
])

export type NodeFamily = z.infer<typeof NodeFamilySchema>

/* ------------------------------------------------------------------ */
/* Policies (failure, concurrency, requirements)                       */
/* ------------------------------------------------------------------ */

/**
 * How a node reacts to an exception. `propagate` re-raises to the
 * workflow level (the workflow's policy applies). `retry` re-runs
 * the node up to `maxAttempts` times with `backoffMs` between
 * attempts; on final failure the workflow's policy applies.
 * `ignore` treats the node as having produced an undefined output
 * and continues.
 */
export const FailurePolicySchema = z.object({
  kind: z.enum(["propagate", "retry", "ignore"]),
  maxAttempts: z.number().int().positive().optional(),
  backoffMs: z.number().int().nonnegative().optional(),
})

export type FailurePolicy = z.infer<typeof FailurePolicySchema>

/**
 * How the workflow scheduler constrains concurrent executions of
 * the same workflow version.
 *
 * - `none`     : no limit; every firing runs in parallel.
 * - `single`   : at most one run at a time; further runs queue.
 * - `group`    : at most N runs in parallel; further runs queue.
 */
export const ConcurrencyPolicySchema = z.object({
  kind: z.enum(["none", "single", "group"]),
  maxConcurrent: z.number().int().positive().optional(),
})

export type ConcurrencyPolicy = z.infer<typeof ConcurrencyPolicySchema>

/**
 * Capabilities a worker must possess to execute a node. The
 * scheduler uses this to pick a compatible worker; a workflow whose
 * nodes all require `gpu` will not start on a worker whose
 * WorkerId does not list `gpu`.
 */
export const ExecutionRequirementsSchema = z.object({
  capabilities: z.array(z.string()).readonly().optional(),
  resourceClass: z.string().optional(),
  executionProfile: z.string().optional(),
})

export type ExecutionRequirements = z.infer<typeof ExecutionRequirementsSchema>

/* ------------------------------------------------------------------ */
/* Edge + node graph                                                   */
/* ------------------------------------------------------------------ */

/**
 * A directed edge from one node to another. `from` and `to` are node
 * ids within the same WorkflowDefinition. `kind` discriminates the
 * meaningful cases:
 * - `flow`: normal data/control flow.
 * - `branch-true` / `branch-false`: the two branches of a
 *   `control.if` family (M1, M2-01).
 * - `branch-N`: a branch edge out of a `control.parallel` family
 *   (M2-03). Zod enums cannot be parameterized by an integer
 *   range, so the literal `branch-N` is used (not `branch-0`,
 *   `branch-1`, …). At runtime, the *target node's branch id*
 *   (from `ControlParallelBranch.branchId`) disambiguates which
 *   branch the edge belongs to — each target node of a fan-out
 *   receives exactly one incoming `branch-N` edge. M2-TEST
 *   validates this convention.
 * - `on-failure`: the unconditional failure branch used by failure
 *   policies.
 */
export const EdgeKindSchema = z.enum([
  "flow",
  "branch-true",
  "branch-false",
  "branch-N",
  "on-failure",
])

export type EdgeKind = z.infer<typeof EdgeKindSchema>

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: EdgeKindSchema,
})

export type Edge = z.infer<typeof EdgeSchema>

/**
 * The shared shape every node carries. Family-specific options live
 * in `config` as an opaque record; the runtime validates `config`
 * against the family's own schema at execution time. Keeping it
 * opaque here lets the IR stay version-stable when a family's
 * options evolve (the family is versioned separately).
 */
export const NodeSchema = z.object({
  /** Stable id within the workflow. */
  id: z.string(),
  family: NodeFamilySchema,
  /** Family-specific configuration. Opaque to the IR. */
  config: z.record(z.string(), z.unknown()),
  /**
   * Per-node timeout in milliseconds. If unset, the workflow's
   * default applies. A value of 0 means "no timeout".
   */
  timeoutMs: z.number().int().nonnegative().optional(),
  /** Per-node failure policy override. */
  failurePolicy: FailurePolicySchema.optional(),
  /** Per-node execution requirements (e.g. min resource class). */
  requirements: ExecutionRequirementsSchema.optional(),
})

export type Node = z.infer<typeof NodeSchema>

/* ------------------------------------------------------------------ */
/* Control node config (M2-01, ADR-002 + ADR-003)                      */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of a `condition` expression. The expression language
 * is bounded (ADR-003): any control-flow predicate lives in a fixed
 * surface so the platform can sandbox it, type-check it, and
 * deterministically evaluate it. 1024 chars is far above the realistic
 * upper bound (~80 chars for a real-world `if` predicate) and well
 * below the adversarial length at which a string-based payload could
 * bloat a content digest.
 */
export const CONTROL_IF_CONDITION_MAX_CHARS = 1024

/**
 * Maximum length of a free-form `description` on a control node. Kept
 * short (280 chars) because the description is metadata for an
 * inspector UI, not a documentation field — the workflow's own
 * `description` is the durable place for prose.
 */
export const CONTROL_IF_DESCRIPTION_MAX_CHARS = 280

/**
 * Configuration of a `control.if` family node (Plan V2.3.1 §198,
 * M2-01, ADR-002 Option A + ADR-003 expression language).
 *
 * The IR keeps `Node.config` opaque (see NodeSchema); this Zod schema
 * is the family's own validator. The runtime calls
 * `parseControlIfConfig(node.config)` after the IR has parsed
 * successfully, so any `Node` with `family: "control.if"` whose
 * `config` does not match this schema is rejected at the trust
 * boundary — never silently passed to a worker.
 *
 * Branch selection is dual-channel:
 * - If `trueBranch` / `falseBranch` is set to a non-empty node id,
 *   the runtime takes that edge (a hard, declared branch).
 * - If it is omitted (or explicitly null), the runtime falls back to
 *   the corresponding `EdgeKind` (`branch-true` / `branch-false`)
 *   leaving the graph topology to drive the routing.
 *
 * The two channels are NOT mutually exclusive: a workflow may declare
 * a `trueBranch` AND have a `branch-true` edge — the declared branch
 * wins, the edge is a documentary default the editor renders when
 * `trueBranch` is null. Validating both at parse time is the
 * contract's job; deciding which one to follow at run time is the
 * kernel's job (ADR-000).
 */
export const ControlIfConfigSchema = z.object({
  /**
   * Expression-language predicate (ADR-003). The schema does not
   * parse the expression itself — it is a non-empty string bounded
   * by `CONTROL_IF_CONDITION_MAX_CHARS`. The expression is evaluated
   * at runtime by the kernel's expression evaluator; the IR only
   * validates its shape and length.
   */
  condition: z
    .string()
    .min(1, "control.if: condition must be non-empty")
    .max(
      CONTROL_IF_CONDITION_MAX_CHARS,
      `control.if: condition must be ≤ ${CONTROL_IF_CONDITION_MAX_CHARS} chars`,
    ),
  /**
   * Optional hard-coded target node id for the true branch. When
   * nullish (null or undefined), the runtime falls back to the
   * `branch-true` edge. When set, the value is a non-empty node id
   * within the same `WorkflowDefinition`.
   */
  trueBranch: z
    .string()
    .min(1, "control.if: trueBranch must be a non-empty node id when set")
    .nullish(),
  /**
   * Optional hard-coded target node id for the false branch.
   * Same semantics as `trueBranch`, but routed to `branch-false` when
   * nullish.
   */
  falseBranch: z
    .string()
    .min(1, "control.if: falseBranch must be a non-empty node id when set")
    .nullish(),
  /**
   * Free-form human description. Display-only — never interpreted.
   * Capped at `CONTROL_IF_DESCRIPTION_MAX_CHARS` so a noisy editor
   * does not push the content digest of a `WorkflowVersion` toward
   * the limits of practical canonicalization.
   */
  description: z
    .string()
    .max(
      CONTROL_IF_DESCRIPTION_MAX_CHARS,
      `control.if: description must be ≤ ${CONTROL_IF_DESCRIPTION_MAX_CHARS} chars`,
    )
    .optional(),
})

export type ControlIfConfig = z.infer<typeof ControlIfConfigSchema>

/**
 * Validate the opaque `config` record of a `control.if` node against
 * `ControlIfConfigSchema`. Throws `z.ZodError` on failure with the
 * field path the caller can use to point at the bad input.
 *
 * The IR's `NodeSchema` keeps `config` as `z.record(z.string(),
 * z.unknown())` so the family-specific shape does not leak into the
 * IR (a new family cannot break parsing of an existing one). This
 * helper is the bridge: every code path that *consumes* a
 * `control.if` node MUST call this before reading the config fields.
 * The runtime does so at the trust boundary; the type system cannot
 * enforce it because `config` is opaque.
 */
export function parseControlIfConfig(config: unknown): ControlIfConfig {
  return ControlIfConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

/**
 * A trigger source attached to a workflow. The kind discriminates
 * the payload; only the relevant fields are required for each kind.
 * Other families (cron, webhook, queue) will be added in later
 * versions of the IR.
 */
export const TriggerDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
  }),
  z.object({
    kind: z.literal("schedule"),
    /** Cron expression in the standard 5-field form. */
    cron: z.string(),
    timezone: z.string().optional(),
    overlapPolicy: OverlapPolicySchema,
    catchUpPolicy: CatchUpPolicySchema,
  }),
])

export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>

/**
 * The binding from a trigger to the workflow that fires on it,
 * plus the runtime-side configuration (overlap, catch-up). A
 * TriggerBinding is durable: deleting the binding is the only way
 * to stop a scheduled workflow firing.
 */
export const TriggerBindingSchema = z.object({
  bindingId: z.string(),
  workflowVersionId: z.string(),
  trigger: TriggerDefinitionSchema,
  createdAt: z.number().int(),
})

export type TriggerBinding = z.infer<typeof TriggerBindingSchema>

/**
 * Runtime-only state of a trigger binding. Stored in the control
 * plane's hot path, not in the canonical IR. `lastFiredAt` and
 * `nextFireAt` are the scheduler's view, not the durable contract.
 */
export const TriggerRuntimeStateSchema = z.object({
  bindingId: z.string(),
  lastFiredAt: z.number().int().nullable(),
  nextFireAt: z.number().int().nullable(),
  inFlightRunId: z.string().nullable(),
  missedFirings: z.number().int().nonnegative(),
})

export type TriggerRuntimeState = z.infer<typeof TriggerRuntimeStateSchema>

/* ------------------------------------------------------------------ */
/* Workflow definition / version / deployment / IR                     */
/* ------------------------------------------------------------------ */

/**
 * The editable form of a workflow. A definition has no
 * content-address; the same definition may produce many versions
 * over its lifetime. The `ownershipScope` is the durable owner
 * (Plan V2.3.1 §44, ADR-020).
 */
export const WorkflowDefinitionSchema = z.object({
  definitionId: z.string(),
  ownershipScope: OwnershipScopeSchema,
  displayName: z.string(),
  description: z.string().optional(),
  nodes: z.array(NodeSchema).readonly(),
  edges: z.array(EdgeSchema).readonly(),
  concurrency: ConcurrencyPolicySchema,
  defaultFailurePolicy: FailurePolicySchema,
  defaultTimeoutMs: z.number().int().nonnegative(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>

/**
 * The immutable, content-addressed snapshot of a workflow at a
 * point in time. The content digest of a version is computed over
 * the JCS-v1 canonicalization of this exact shape; the resulting
 * digest becomes the version's id on the wire.
 *
 * `versionDigest` is the *self-reported* digest, set by the
 * canonicalization step. The control plane MUST verify it matches
 * the recomputed digest before accepting the version. A missing
 * `versionDigest` is rejected at the validation boundary.
 */
export const WorkflowVersionSchema = z.object({
  versionId: z.string(),
  definitionId: z.string(),
  versionNumber: z.number().int().positive(),
  definition: WorkflowDefinitionSchema,
  // ADR-026: `versionDigest` is typed by domain. A Zod parse of a
  // `WorkflowVersion` rejects any envelope whose `domain` literal is
  // not `"workflow-version"` — the cross-domain guard lives at the
  // parsing boundary, not only at the runtime `asDomainDigest()` call.
  versionDigest: WorkflowVersionDigestSchema,
  createdAt: z.number().int(),
  createdBy: z.string(),
})

export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>

/**
 * The act of pinning a workflow version to an environment. A
 * deployment is the durable handle used by triggers, schedulers,
 * and the control plane to look up "what runs in prod right now".
 */
export const WorkflowDeploymentSchema = z.object({
  deploymentId: z.string(),
  deploymentScope: DeploymentScopeSchema,
  workflowVersionId: z.string(),
  pinnedAt: z.number().int(),
  pinnedBy: z.string(),
  active: z.boolean(),
})

export type WorkflowDeployment = z.infer<typeof WorkflowDeploymentSchema>

/**
 * The IR is the union of everything a workflow runtime needs to
 * load a workflow's behavior and lifecycle. The control plane
 * serializes a single IR document per workflow per environment.
 */
export const WorkflowIRSchema = z.object({
  definition: WorkflowDefinitionSchema,
  version: WorkflowVersionSchema,
  deployment: WorkflowDeploymentSchema,
  triggers: z.array(TriggerBindingSchema).readonly(),
})

export type WorkflowIR = z.infer<typeof WorkflowIRSchema>
