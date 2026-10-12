/* SPDX-License-Identifier: MIT */
/**
 * `unifia knowledge conflicts apply`: execute a plan, under the write lock, in steps a crash can interrupt.
 *
 * The steps, each one durable before the next (the decisions file is the journal):
 *   started     the decisions file records the start, with the plan's hashes; writes to the note are refused from here
 *   preserved   the version the choice does not keep is copied into the conflict's record, and verified
 *   committed   pending: the temporary replaces the destination. current: the temporary is removed. both: the new note is written
 *               (through the writer's create, so it is in the log), then the temporary is removed
 *   completed   the decisions file records the completion; the note is writable again
 *
 * A crash between steps is finished by the next apply, which checks the state against the plan it interrupted: it completes the
 * record, or refuses and changes nothing. Nothing is deleted. The version a choice does not keep stays in the preservation folder.
 */

import { unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { TMP_SUFFIX, fsyncDirectory, renameDurable } from "../mutation/durability.js"
import { isInternalLocator, isInternalPlace, realOrNull, wouldBeContained } from "../source/containment.js"
import {
  type ApplyEvent,
  type DecisionEvent,
  type KeepChoice,
  type OperatorIdentity,
  type PlanEvent,
  appendDecision,
  assertConflictId,
  assertOperatorFolders,
  assertRecordFolders,
  currentOperator,
  preservedRelOf,
  preserveVersion,
  readDecisions,
  refuse,
  withNoteIdentity,
} from "../mutation/conflict-record.js"
import { type ConflictFact, inspectFile, scanConflicts } from "../mutation/conflict-scan.js"
import { WAL_FILE } from "../mutation/writer.js"
import { plansIn } from "./conflicts.js"

/** The steps of an apply, in order. A hook named for a step runs right after that step is durable. */
export type ApplyStep = "started" | "preserved" | "note" | "committed" | "completed"

/** Test seams: a hook that throws after a step stops the apply where a crash would have. */
export interface ApplyHooks {
  afterStep?: (step: ApplyStep) => void
}

/** What an apply needs of the writer: its write lock, and the create of a note under that lock. */
export interface ConflictWriterPort {
  withWriteLock<T>(work: () => T): T
  commitNewNote(locator: string, raw: string, source: string, reason: string): string
}

export interface ApplyInput {
  id: string
  /** The plan to execute. Default: the latest plan of the conflict. */
  planId?: string
  operator?: OperatorIdentity
  hooks?: ApplyHooks
}

/**
 * What an apply did: `applied` (this call made the change), `finished` (an interrupted apply was completed by this call, which
 * verified the vault against its plan first), or `noop` (the plan was already applied, and nothing changed).
 */
export interface ApplyOutcome {
  outcome: "applied" | "finished" | "noop"
  id: string
  planId: string
  keep: KeepChoice
  locator: string
  preserved: string[]
  newLocator: string | null
}

/** Execute the plan of a conflict. Synchronous: the writer's lock is held for the whole of it. */
export function applyConflict(port: ConflictWriterPort, root: string, input: ApplyInput): ApplyOutcome {
  assertConflictId(input.id)
  const operator = input.operator ?? currentOperator()
  assertOperatorFolders(root, operator)
  const hooks = input.hooks ?? {}
  return port.withWriteLock(() => runUnderLock(port, root, input.id, input.planId, operator, hooks))
}

function runUnderLock(
  port: ConflictWriterPort,
  root: string,
  id: string,
  planId: string | undefined,
  operator: OperatorIdentity,
  hooks: ApplyHooks,
): ApplyOutcome {
  const events = readDecisions(root)
  const plan = pickPlan(events, id, planId)
  assertPlanPlaces(root, plan)
  const fact = scanConflicts(root, WAL_FILE).find((f) => f.id === id)
  if (fact === undefined) return settleWithoutConflict(root, id, events, plan, operator)
  return applyHeld(port, root, fact, plan, events, operator, hooks)
}

/** The plan to execute: the one named, or the latest. A conflict with no plan is refused: the owner plans first. */
function pickPlan(events: readonly DecisionEvent[], id: string, planId: string | undefined): PlanEvent {
  const plans = plansIn(events, id)
  if (planId === undefined) {
    const latest = plans.at(-1)
    if (latest === undefined) throw refuse("no plan for this conflict: run plan first")
    return latest
  }
  const found = plans.find((p) => p.planId === planId)
  if (found === undefined) throw refuse("no plan with that id is recorded for this conflict")
  return found
}

/** The last start or completion of a conflict's apply: the journal's state. */
function journalOf(events: readonly DecisionEvent[], id: string): ApplyEvent | undefined {
  let last: ApplyEvent | undefined
  for (const event of events) {
    if (event.conflictId === id && (event.event === "apply-started" || event.event === "apply-completed")) last = event
  }
  return last
}

/**
 * The places a plan names must be note places of the vault: a `.md` file inside the vault and outside its own folder. The decisions
 * file is owner-only, but a place is judged as the writer judges one, before anything is renamed or created at it.
 */
function assertPlanPlaces(root: string, plan: PlanEvent): void {
  const realRoot = realOrNull(root)
  const places = plan.keepLocator === null ? [plan.locator] : [plan.locator, plan.keepLocator]
  for (const place of places) {
    if (
      realRoot === null ||
      !place.endsWith(".md") ||
      isInternalLocator(place) ||
      isInternalPlace(realRoot, join(root, place)) ||
      !wouldBeContained(realRoot, join(root, place))
    ) {
      throw refuse("the plan names a place that is not a note of the vault")
    }
  }
}

/** An apply line for `plan`, by `operator`. */
function applyLine(
  event: ApplyEvent["event"],
  plan: PlanEvent,
  operator: OperatorIdentity,
  extra: Partial<Pick<ApplyEvent, "preserved" | "newLocator" | "reason">> = {},
): ApplyEvent {
  return {
    event,
    at: new Date().toISOString(),
    actor: operator,
    conflictId: plan.conflictId,
    planId: plan.planId,
    keep: plan.keep,
    locator: plan.locator,
    currentHash: plan.currentHash,
    pendingHash: plan.pendingHash,
    ...extra,
  }
}

/** Record a refusal of `plan` and refuse with its reason. A refusal changes nothing and does not close an interrupted apply. */
function refusedAt(root: string, plan: PlanEvent, operator: OperatorIdentity, reason: string): never {
  appendDecision(root, applyLine("apply-refused", plan, operator, { reason }), operator)
  throw refuse(reason)
}

function outcomeOf(
  outcome: ApplyOutcome["outcome"],
  plan: PlanEvent,
  preserved: string[],
  newLocator: string | null,
): ApplyOutcome {
  return { outcome, id: plan.conflictId, planId: plan.planId, keep: plan.keep, locator: plan.locator, preserved, newLocator }
}

/**
 * The conflict is not held: either an apply of this plan completed (a second apply is a no-op that reports it), or an apply that
 * started did not finish (it is finished here, if the vault verifies against its plan), or the held write went away by another route
 * (refused: the plan no longer describes the vault).
 */
function settleWithoutConflict(
  root: string,
  id: string,
  events: readonly DecisionEvent[],
  plan: PlanEvent,
  operator: OperatorIdentity,
): ApplyOutcome {
  const last = journalOf(events, id)
  if (last?.event === "apply-started") {
    const interrupted = plansIn(events, id).find((p) => p.planId === last.planId)
    if (interrupted === undefined) refusedAt(root, plan, operator, "the interrupted apply has no plan record: it is not finished")
    return finishInterrupted(root, interrupted, operator)
  }
  if (last?.event === "apply-completed" && last.planId === plan.planId) {
    appendDecision(root, applyLine("apply-noop", plan, operator), operator)
    return outcomeOf("noop", plan, [], null)
  }
  return refusedAt(
    root,
    plan,
    operator,
    "the conflict is not unresolved: it was resolved by another step, or its pending bytes or log entry changed since the plan; plan it again",
  )
}

/** The preserved copies a plan's applied choice leaves, vault-relative. */
function preservedOf(plan: PlanEvent): string[] {
  if (plan.keep === "pending") return plan.currentHash === null ? [] : [preservedRelOf(plan.conflictId, "current", plan.currentHash)]
  if (plan.keep === "current") return [preservedRelOf(plan.conflictId, "pending", plan.pendingHash)]
  return []
}

/** The hash of the file at `locator`: null when absent, undefined when it is a link or not a file of its own. */
function hashAt(root: string, locator: string): string | null | undefined {
  const state = inspectFile(root, locator)
  if (state.state === "absent") return null
  if (state.state === "file") return state.hash
  return undefined
}

/** Whether the file at `locator` is a file of its own holding `hash`. */
function holds(root: string, locator: string, hash: string | null): boolean {
  return hash !== null && hashAt(root, locator) === hash
}

/** Whether the vault shows every effect the plan's choice has: the destination, the preserved copies, and the new note. */
function verifiesFinished(root: string, plan: PlanEvent): boolean {
  const destination = hashAt(root, plan.locator)
  if (destination === undefined) return false
  if (inspectFile(root, `${plan.locator}${TMP_SUFFIX}`).state !== "absent") return false
  if (plan.keep === "pending") {
    return (
      destination === plan.pendingHash &&
      (plan.currentHash === null || holds(root, preservedRelOf(plan.conflictId, "current", plan.currentHash), plan.currentHash))
    )
  }
  if (plan.keep === "current") {
    return destination === plan.currentHash && holds(root, preservedRelOf(plan.conflictId, "pending", plan.pendingHash), plan.pendingHash)
  }
  return (
    destination === plan.currentHash &&
    plan.keepLocator !== null &&
    holds(root, plan.keepLocator, plan.newNoteHash)
  )
}

/** Complete an interrupted apply: verify the vault against its plan, then record the completion. Otherwise refuse, changing nothing. */
function finishInterrupted(root: string, plan: PlanEvent, operator: OperatorIdentity): ApplyOutcome {
  assertPlanPlaces(root, plan)
  if (!verifiesFinished(root, plan)) {
    refusedAt(
      root,
      plan,
      operator,
      "the interrupted apply cannot be verified against its plan: the note does not hold the planned bytes; nothing was changed",
    )
  }
  const preserved = preservedOf(plan)
  const newLocator = plan.keep === "both" ? plan.keepLocator : null
  appendDecision(root, applyLine("apply-completed", plan, operator, { preserved, newLocator }), operator)
  return outcomeOf("finished", plan, preserved, newLocator)
}

/** Why the vault no longer holds what the plan was made against, or null when it still does. */
function changedSince(plan: PlanEvent, fact: ConflictFact): string | null {
  if (fact.current.state === "link" || fact.current.state === "other") {
    return "the destination is a link or not a file of its own"
  }
  const currentNow = fact.current.state === "file" ? fact.current.hash : null
  if (currentNow !== plan.currentHash) return "the destination changed since the plan"
  if (fact.pending.hash !== plan.pendingHash) return "the pending bytes changed since the plan"
  if (fact.lastSeq !== plan.lastSeq) return "the note's log entries changed since the plan"
  return null
}

function applyHeld(
  port: ConflictWriterPort,
  root: string,
  fact: ConflictFact,
  plan: PlanEvent,
  events: readonly DecisionEvent[],
  operator: OperatorIdentity,
  hooks: ApplyHooks,
): ApplyOutcome {
  const changed = changedSince(plan, fact)
  if (changed !== null) refusedAt(root, plan, operator, `${changed}: nothing was applied; plan it again`)
  const last = journalOf(events, plan.conflictId)
  if (last?.event === "apply-completed" && last.planId === plan.planId) {
    refusedAt(root, plan, operator, "this plan was applied and the conflict is held again: plan it again")
  }
  assertRecordFolders(root, plan.conflictId, operator)

  appendDecision(root, applyLine("apply-started", plan, operator), operator)
  hooks.afterStep?.("started")
  try {
    return runSteps(port, root, fact, plan, operator, hooks)
  } catch {
    // The journal stays open: the note stays refused until an apply finishes this one, and the next apply verifies the state.
    throw refuse("the apply did not finish: the conflict stays held, and the next apply finishes it or refuses")
  }
}

/** The steps of the choice, in order, each followed by its hook. */
function runSteps(
  port: ConflictWriterPort,
  root: string,
  fact: ConflictFact,
  plan: PlanEvent,
  operator: OperatorIdentity,
  hooks: ApplyHooks,
): ApplyOutcome {
  const tmp = `${plan.locator}${TMP_SUFFIX}`
  let preserved: string[] = []
  let newLocator: string | null = null
  if (plan.keep === "pending") {
    if (fact.current.state === "file") {
      preserved = [preserveVersion(root, plan.conflictId, "current", fact.current.bytes, fact.current.hash, operator)]
    }
    hooks.afterStep?.("preserved")
    requireHash(root, plan.locator, plan.currentHash)
    renameDurable(join(root, tmp), join(root, plan.locator))
    fsyncDirectory(dirname(join(root, plan.locator)))
    hooks.afterStep?.("committed")
  } else if (plan.keep === "current") {
    preserved = [preserveVersion(root, plan.conflictId, "pending", fact.pending.bytes, fact.pending.hash, operator)]
    hooks.afterStep?.("preserved")
    requireHash(root, tmp, plan.pendingHash)
    unlinkSync(join(root, tmp))
    fsyncDirectory(dirname(join(root, tmp)))
    hooks.afterStep?.("committed")
  } else {
    newLocator = writeNewNote(port, fact, plan, operator)
    hooks.afterStep?.("note")
    requireHash(root, plan.locator, plan.currentHash)
    requireHash(root, tmp, plan.pendingHash)
    unlinkSync(join(root, tmp))
    fsyncDirectory(dirname(join(root, tmp)))
    hooks.afterStep?.("committed")
  }
  appendDecision(root, applyLine("apply-completed", plan, operator, { preserved, newLocator }), operator)
  hooks.afterStep?.("completed")
  return outcomeOf("applied", plan, preserved, newLocator)
}

/** Write the pending version as a note of its own, with the planned identity, through the writer's create. */
function writeNewNote(port: ConflictWriterPort, fact: ConflictFact, plan: PlanEvent, operator: OperatorIdentity): string {
  if (plan.keepLocator === null || plan.newNoteId === null || plan.newNoteHash === null) {
    throw refuse("the plan names no new note")
  }
  const text = withNoteIdentity(fact.pending.bytes.toString("utf8"), plan.newNoteId)
  if (text === null) throw refuse("the pending version cannot be given the planned identity")
  const hash = port.commitNewNote(
    plan.keepLocator,
    text,
    `operator:${operator.user}`,
    `kept as a note of its own by conflict ${plan.conflictId}`,
  )
  if (hash !== plan.newNoteHash) throw refuse("the new note does not hold the planned bytes")
  return plan.keepLocator
}

/** Refuse unless the file at `locator` still holds `expected` (null: absent). Checked right before each replacement or removal. */
function requireHash(root: string, locator: string, expected: string | null): void {
  if (hashAt(root, locator) !== expected) {
    throw refuse("a file changed while the apply ran: the apply stops here; the next apply finishes it or refuses")
  }
}
