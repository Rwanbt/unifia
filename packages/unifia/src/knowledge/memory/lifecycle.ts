/* SPDX-License-Identifier: MIT */
/**
 * Memory lifecycle (P4).
 *
 * Per ADR-KNOW-0009: candidate → active → superseded → archived.
 * Transitions are explicit, audited, and refused if unauthorised.
 */

import type {
  KnowledgeId,
  KnowledgeLifecycleState,
  MutationIntent,
  MutationResult,
  MutationKind,
} from "@unifia/contracts/knowledge"

const VALID_TRANSITIONS: Record<KnowledgeLifecycleState, KnowledgeLifecycleState[]> = {
  candidate: ["active", "archived"],
  active: ["superseded", "archived"],
  superseded: ["active", "archived"],
  archived: ["active"],
}

export interface LifecycleTransition {
  from: KnowledgeLifecycleState
  to: KnowledgeLifecycleState
  /** Audit record. */
  auditId: string
  /** Reason, for audit. */
  reason: string
  /** Source agent / user. */
  source: string
}

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LifecycleError"
  }
}

/** Decide whether a transition is allowed. */
export function isTransitionAllowed(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

/** A transition decision. */
export type TransitionDecision =
  | { allowed: true; intent: MutationIntent }
  | { allowed: false; reason: string }

const VALID_MUTATION_KINDS: MutationKind[] = [
  "create", "update", "delete", "move", "promote", "supersede", "archive", "restore",
]

/** Map a transition to a MutationIntent kind. */
export function intentForTransition(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
  targetId: KnowledgeId,
  expectedVersionHash: string,
  reason: string,
  source: string,
): TransitionDecision {
  if (!isTransitionAllowed(from, to)) {
    return { allowed: false, reason: `transition ${from} -> ${to} is not allowed` }
  }
  const kind: MutationKind | undefined =
    to === "active" && from === "candidate" ? "promote" :
    to === "active" && from === "archived" ? "restore" :
    to === "superseded" ? "supersede" :
    to === "archived" ? "archive" :
    undefined
  if (kind === undefined) {
    return { allowed: false, reason: `no mutation kind for ${from} -> ${to}` }
  }
  if (!VALID_MUTATION_KINDS.includes(kind)) {
    return { allowed: false, reason: `mutation kind ${kind} is not in the V1 set` }
  }
  return {
    allowed: true,
    intent: {
      kind,
      targetId,
      expectedVersionHash: expectedVersionHash as MutationIntent["expectedVersionHash"],
      reason,
      source,
    },
  }
}

/** Construct a MutationResult for a successful transition. */
export function transitionResult(
  auditId: string,
  newLifecycle: KnowledgeLifecycleState,
): MutationResult {
  return { applied: true, newLifecycle, auditId }
}
