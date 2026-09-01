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
import { DigestEnvelopeSchema, DigestDomainSchema, type DigestDomain } from "./digest.js"
import { OverlapPolicySchema, CatchUpPolicySchema } from "./timer.js"

// Re-export so callers that import from this file still see DigestDomainSchema
// next to WorkflowIRSchema. The authoritative definition lives in digest.ts.
export { DigestDomainSchema }
export type { DigestDomain }

/* ------------------------------------------------------------------ */
/* Node families (ADR-002 Option A)                                    */
/* ------------------------------------------------------------------ */

/**
 * The six node families in the first target. The dotted form
 * (`family.verb`) is preserved as a literal string so the IR is
 * self-describing in logs and on the wire.
 */
export const NodeFamilySchema = z.enum([
  "trigger.manual",
  "trigger.schedule",
  "control.if",
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
 * three meaningful cases: a normal data/control flow, the "true" and
 * "false" branches of a `control.if` family, and the unconditional
 * "on-failure" branch used by failure policies.
 */
export const EdgeKindSchema = z.enum(["flow", "branch-true", "branch-false", "on-failure"])

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
  versionDigest: DigestEnvelopeSchema,
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
