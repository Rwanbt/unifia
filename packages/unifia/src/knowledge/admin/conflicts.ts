/* SPDX-License-Identifier: MIT */
/**
 * `unifia knowledge conflicts list`, `show` and `plan`: the owner's view of the conflicts recovery left, and the first step of
 * resolving one. `list` and `show` change nothing. `plan` appends one line to the decisions file and makes the conflict's record if
 * it has none; it takes no write lock and touches no note. `apply` (conflict-apply.ts) is the step that changes the vault.
 *
 * A plan records the choice and the hashes it was made against. Apply executes it only while those hashes still hold.
 */

import { randomBytes } from "node:crypto"
import { join, posix } from "node:path"
import { WAL_FILE, randomUUIDv7 } from "../mutation/writer.js"
import { isInternalLocator, realOrNull, wouldBeContained } from "../source/containment.js"
import {
  type DecisionEvent,
  type KeepChoice,
  type OperatorIdentity,
  type PlanEvent,
  appendDecision,
  assertConflictId,
  assertOperatorFolders,
  currentOperator,
  entryPresent,
  ensureRecord,
  interruptedIn,
  readDecisions,
  refuse,
  withNoteIdentity,
} from "../mutation/conflict-record.js"
import { type ConflictFact, type FileState, inspectFile, scanConflicts, sha256Hex } from "../mutation/conflict-scan.js"
import type { WalKind } from "../wal/wal.js"
import { parseFrontmatter } from "../parser/frontmatter.js"

export type { KeepChoice } from "../mutation/conflict-record.js"

/** The choices a plan accepts. */
export const KEEP_CHOICES: readonly KeepChoice[] = ["pending", "current", "both"]

/** The most bytes of a version a detail shows. */
const PREVIEW_BYTES = 512

/** A version as the owner reads it: absent, a file (with its hash and size), a link, or another kind of entry. */
export interface VersionView {
  state: FileState["state"]
  hash: string | null
  size: number | null
  /** A bounded, printable start of the version; null when the version is not read. */
  preview: string | null
}

/** One row of `list`. */
export interface ConflictListing {
  id: string
  locator: string
  operation: WalKind | null
  seq: number | null
  pendingHash: string
  /** The destination now. */
  currentState: FileState["state"]
  /** The pending temporary is still held, so writes to the note are refused. */
  held: boolean
  /** An apply of this conflict started and did not finish. */
  openApply: boolean
}

/** The latest plan of a conflict, as `show` reports it. */
export interface PlanSummary {
  planId: string
  keep: KeepChoice
  at: string
  actor: OperatorIdentity
  currentHash: string | null
  pendingHash: string
}

/** `show`: the operation, the note, both versions, and the latest plan. */
export interface ConflictDetail {
  id: string
  locator: string
  operation: WalKind | null
  seq: number | null
  auditId: string | null
  source: string | null
  reason: string | null
  timestamp: string | null
  /** The newest log entry for the note, and the later entry that is not the pending one, when there is one. */
  lastSeq: number | null
  later: { seq: number; kind: WalKind } | null
  held: boolean
  openApply: boolean
  pending: { hash: string; size: number; preview: string | null }
  current: VersionView
  latestPlan: PlanSummary | null
}

/** What a plan returns: the choice and the hashes it records. */
export interface PlanRecord {
  planId: string
  id: string
  keep: KeepChoice
  locator: string
  operation: WalKind | null
  seq: number | null
  lastSeq: number | null
  currentHash: string | null
  pendingHash: string
  keepLocator: string | null
  newNoteId: string | null
  newNoteHash: string | null
  at: string
  actor: OperatorIdentity
}

/** A printable, bounded start of a version: newlines shown as `\n`, control characters escaped. */
function previewOf(bytes: Buffer): string {
  const head = bytes.subarray(0, PREVIEW_BYTES).toString("utf8")
  const printable = head
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
  return bytes.length > PREVIEW_BYTES ? `${printable}…` : printable
}

function viewOf(state: FileState): VersionView {
  if (state.state === "file") {
    return { state: "file", hash: state.hash, size: state.size, preview: previewOf(state.bytes) }
  }
  return { state: state.state, hash: null, size: null, preview: null }
}

function planSummaryOf(plan: PlanEvent): PlanSummary {
  return {
    planId: plan.planId,
    keep: plan.keep,
    at: plan.at,
    actor: plan.actor,
    currentHash: plan.currentHash,
    pendingHash: plan.pendingHash,
  }
}

/** The plans recorded for one conflict, oldest first. */
export function plansIn(events: readonly DecisionEvent[], id: string): PlanEvent[] {
  return events.filter((e): e is PlanEvent => e.event === "plan" && e.conflictId === id)
}

/** The conflicts the vault holds now. Refuses an operator who does not own the vault's folders. */
function scanAs(root: string, operator: OperatorIdentity): ConflictFact[] {
  assertOperatorFolders(root, operator)
  return scanConflicts(root, WAL_FILE)
}

/** The conflicts the owner must look at: those still held, and those whose apply started and did not finish. */
export function listConflicts(root: string, operator: OperatorIdentity = currentOperator()): ConflictListing[] {
  const held = scanAs(root, operator)
  const events = readDecisions(root)
  const interrupted = interruptedIn(events)
  const open = new Set(interrupted.map((e) => e.conflictId))
  const rows: ConflictListing[] = held.map((fact) => ({
    id: fact.id,
    locator: fact.locator,
    operation: fact.operation,
    seq: fact.seq,
    pendingHash: fact.pending.hash,
    currentState: fact.current.state,
    held: true,
    openApply: open.has(fact.id),
  }))
  const heldIds = new Set(held.map((f) => f.id))
  for (const event of interrupted) {
    if (heldIds.has(event.conflictId)) continue
    const plan = plansIn(events, event.conflictId).find((p) => p.planId === event.planId)
    rows.push({
      id: event.conflictId,
      locator: event.locator,
      operation: plan?.operation ?? null,
      seq: plan?.seq ?? null,
      pendingHash: event.pendingHash,
      currentState: inspectFile(root, event.locator).state,
      held: false,
      openApply: true,
    })
  }
  return rows.sort((a, b) => a.locator.localeCompare(b.locator) || a.id.localeCompare(b.id))
}

/**
 * The detail of one conflict: the held one, or, when its apply started and its temporary is gone, the plan that apply executes,
 * with the versions as the plan recorded them (not read again).
 */
export function showConflict(root: string, id: string, operator: OperatorIdentity = currentOperator()): ConflictDetail {
  assertConflictId(id)
  const held = scanAs(root, operator).find((f) => f.id === id)
  const events = readDecisions(root)
  const plans = plansIn(events, id)
  const interrupted = interruptedIn(events).find((e) => e.conflictId === id)
  if (held !== undefined) return detailOfHeld(held, interrupted !== undefined, plans.at(-1))
  const plan = interrupted === undefined ? undefined : plans.find((p) => p.planId === interrupted.planId)
  if (plan === undefined) throw refuse("no unresolved conflict has this id")
  return detailOfInterrupted(plan)
}

/** The detail of a held conflict: both versions read now, and the latest plan. */
function detailOfHeld(fact: ConflictFact, openApply: boolean, latest: PlanEvent | undefined): ConflictDetail {
  return {
    id: fact.id,
    locator: fact.locator,
    operation: fact.operation,
    seq: fact.seq,
    auditId: fact.auditId,
    source: fact.source,
    reason: fact.reason,
    timestamp: fact.timestamp,
    lastSeq: fact.lastSeq,
    later: fact.later,
    held: true,
    openApply,
    pending: { hash: fact.pending.hash, size: fact.pending.size, preview: previewOf(fact.pending.bytes) },
    current: viewOf(fact.current),
    latestPlan: latest === undefined ? null : planSummaryOf(latest),
  }
}

/** The detail of an interrupted apply whose temporary is gone: the versions as its plan recorded them, not read again. */
function detailOfInterrupted(plan: PlanEvent): ConflictDetail {
  return {
    id: plan.conflictId,
    locator: plan.locator,
    operation: plan.operation,
    seq: plan.seq,
    auditId: null,
    source: null,
    reason: null,
    timestamp: null,
    lastSeq: plan.lastSeq,
    later: null,
    held: false,
    openApply: true,
    pending: { hash: plan.pendingHash, size: plan.pendingSize, preview: null },
    current: {
      state: plan.currentHash === null ? "absent" : "file",
      hash: plan.currentHash,
      size: plan.currentSize,
      preview: null,
    },
    latestPlan: planSummaryOf(plan),
  }
}

export interface PlanInput {
  id: string
  keep: KeepChoice
  /** For keep-both: the vault-relative place of the new note. Default: beside the note, named with the conflict's id. */
  as?: string
  operator?: OperatorIdentity
}

/** The default place of the note a keep-both plan writes: `dir/stem (conflict <id8>).md`, beside the note it came from. */
function defaultKeepPlace(locator: string, id: string): string {
  const dir = posix.dirname(locator)
  const stem = posix.basename(locator, ".md")
  return `${dir === "." ? "" : `${dir}/`}${stem} (conflict ${id.slice(0, 8)}).md`
}

/** The place of a keep-both note: a `.md` file inside the vault, outside the vault's own folder, and not taken. */
function keepPlaceOf(root: string, fact: ConflictFact, as: string | undefined): string {
  const place = as ?? defaultKeepPlace(fact.locator, fact.id)
  if (!place.endsWith(".md")) throw refuse("the new note must be a .md file")
  const realRoot = realOrNull(root)
  if (realRoot === null || !wouldBeContained(realRoot, join(root, place))) {
    throw refuse("the new note's place must stay inside the vault")
  }
  if (isInternalLocator(place)) throw refuse("the new note's place is reserved for the vault's own bookkeeping")
  if (entryPresent(join(root, place))) throw refuse("the new note's place is already taken")
  return place
}

/** Whether a text's frontmatter carries exactly this identity, and parses as a note. */
function carriesIdentity(text: string, id: string): boolean {
  try {
    return parseFrontmatter(text).frontmatter.unifia_id === id
  } catch {
    return false
  }
}

/** The identity and the bytes of the new note a keep-both plan will write, from the pending version. */
function newNoteOf(fact: ConflictFact): { id: string; hash: string } {
  const pendingText = fact.pending.bytes.toString("utf8")
  if (!Buffer.from(pendingText, "utf8").equals(fact.pending.bytes)) {
    throw refuse("the pending version is not UTF-8 text, so it cannot be kept as a note of its own")
  }
  const id = randomUUIDv7()
  const text = withNoteIdentity(pendingText, id)
  if (text === null || !carriesIdentity(text, id)) throw refuse("the pending version has no identity line to give the new note")
  return { id, hash: sha256Hex(text) }
}

/**
 * Record the owner's choice for a held conflict, with the hashes it is made against. Refused for a conflict the vault no longer
 * holds, for a destination that is a link or not a file of its own (it is never read through or replaced), and for a keep-both
 * whose pending version is not UTF-8 text or has no identity line to give the new note.
 */
export function planConflict(root: string, input: PlanInput): PlanRecord {
  assertConflictId(input.id)
  if (!KEEP_CHOICES.includes(input.keep)) throw refuse("keep must be pending, current or both")
  const operator = input.operator ?? currentOperator()
  const fact = scanAs(root, operator).find((f) => f.id === input.id)
  if (fact === undefined) throw refuse("no unresolved conflict has this id")
  // Read before anything is written: a decisions file that is a link is refused here, not after a record is made.
  readDecisions(root)
  if (fact.current.state === "link" || fact.current.state === "other") {
    throw refuse(`the note ${fact.locator} is a link or not a file of its own; it is not read or replaced: resolve it by hand`)
  }

  const keepLocator = input.keep === "both" ? keepPlaceOf(root, fact, input.as) : null
  const newNote = input.keep === "both" ? newNoteOf(fact) : null
  ensureRecord(root, fact, operator)

  const at = new Date().toISOString()
  const planId = randomBytes(8).toString("hex")
  const currentHash = fact.current.state === "file" ? fact.current.hash : null
  const currentSize = fact.current.state === "file" ? fact.current.size : null
  appendDecision(
    root,
    {
      event: "plan",
      at,
      actor: operator,
      conflictId: input.id,
      planId,
      keep: input.keep,
      locator: fact.locator,
      operation: fact.operation,
      seq: fact.seq,
      lastSeq: fact.lastSeq,
      currentHash,
      currentSize,
      pendingHash: fact.pending.hash,
      pendingSize: fact.pending.size,
      keepLocator,
      newNoteId: newNote?.id ?? null,
      newNoteHash: newNote?.hash ?? null,
    },
    operator,
  )
  return {
    planId,
    id: input.id,
    keep: input.keep,
    locator: fact.locator,
    operation: fact.operation,
    seq: fact.seq,
    lastSeq: fact.lastSeq,
    currentHash,
    pendingHash: fact.pending.hash,
    keepLocator,
    newNoteId: newNote?.id ?? null,
    newNoteHash: newNote?.hash ?? null,
    at,
    actor: operator,
  }
}
