/* SPDX-License-Identifier: MIT */
/**
 * The conflict record and the decisions file.
 *
 * Under the vault's internal folder:
 *   .unifia/conflicts/                  the conflict folder: owner-only, never a link
 *   .unifia/conflicts/decisions.jsonl   append-only: every plan and apply, with the actor, time, id, choice and hashes
 *   .unifia/conflicts/<id>/record.json  the record recovery makes when it leaves a conflict in place
 *   .unifia/conflicts/<id>/preserved/   the version a resolution did not keep, named by its role and its hash
 *
 * The decisions file is the journal of an apply as well as its audit trail: an apply writes `apply-started` before its first step
 * and `apply-completed` after its last. A started apply with no completion is an interrupted one, and the writer refuses writes to
 * its note until the next apply finishes it.
 *
 * The WAL is never edited or truncated by anything here. A resolution that writes a note writes it through the writer's create.
 */

import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"
import type { WalKind } from "../wal/wal.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { parseFrontmatter } from "../parser/frontmatter.js"
import { realOrNull } from "../source/containment.js"
import { appendLineDurable, fsyncDirectory, readNoFollow, recoveryKey, renameDurable } from "./durability.js"
import { type ConflictFact, inspectFile, scanConflicts } from "./conflict-scan.js"

/** The conflict folder, under the vault's internal folder. */
export const CONFLICTS_DIR = ".unifia/conflicts"

/** The append-only decisions file. */
export const DECISIONS_FILE = ".unifia/conflicts/decisions.jsonl"

/** The folder of a resolution's preserved versions, inside a conflict's record. */
const PRESERVED_DIR = "preserved"

const RECORD_FILE = "record.json"

/** The three choices a plan can record. */
export type KeepChoice = "pending" | "current" | "both"

/** The operating-system user a decision is recorded for. `uid` is null where the platform has none. */
export interface OperatorIdentity {
  user: string
  uid: number | null
}

/** The hashes and the choice a plan was made against, and the identity of the new note a keep-both plan will write. */
export interface PlanEvent {
  event: "plan"
  at: string
  actor: OperatorIdentity
  conflictId: string
  planId: string
  keep: KeepChoice
  locator: string
  operation: WalKind | null
  seq: number | null
  /** The sequence number of the newest log entry for the note when the plan was made. */
  lastSeq: number | null
  /** The destination's hash and size, or null when the destination was absent. */
  currentHash: string | null
  currentSize: number | null
  pendingHash: string
  pendingSize: number
  keepLocator: string | null
  newNoteId: string | null
  newNoteHash: string | null
  reason?: string
}

/** An apply's line: its start, its completion, a refusal, or a no-op. An apply line carries the plan it was made for. */
export interface ApplyEvent {
  event: "apply-started" | "apply-completed" | "apply-refused" | "apply-noop"
  at: string
  actor: OperatorIdentity
  conflictId: string
  planId: string
  keep: KeepChoice
  locator: string
  currentHash: string | null
  pendingHash: string
  preserved?: string[]
  newLocator?: string | null
  reason?: string
}

/** One line of the decisions file. */
export type DecisionEvent = PlanEvent | ApplyEvent

/** A conflict identifier is the 16 hex digits the scan gives. Anything else is refused before it names a path. */
const CONFLICT_ID = /^[0-9a-f]{16}$/

/** Refuse with a message that names no path: the operating system's message would carry the absolute path of the vault. */
export function refuse(message: string): KnowledgeFailure {
  return KnowledgeFailure.mutationRefused(message)
}

/** Refuse an identifier that the scan could not have given. */
export function assertConflictId(id: string): void {
  if (!CONFLICT_ID.test(id)) throw refuse("the identifier is not a conflict id")
}

/** The operating-system user running the command. Where no account name is available the environment's name stands in. */
export function currentOperator(): OperatorIdentity {
  let user = process.env.USER ?? process.env.USERNAME ?? "unknown"
  try {
    user = userInfo().username
  } catch {
    // No account entry: the environment's name is recorded.
  }
  const uid = process.platform === "win32" || typeof process.getuid !== "function" ? null : process.getuid()
  return { user, uid }
}

/** Whether anything is at `path`: a link, even a dangling one, counts. */
export function entryPresent(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Refuse a folder that is a link, not a folder, not owned by the operator, or writable by others.
 *
 * Node's fs API exposes neither the owner nor the ACL on Windows (the uid there is 0, and the mode reports only the read-only
 * attribute), so on Windows the check is the link and folder-type test alone. That is recorded as an open point.
 */
function assertOwnedFolder(path: string, what: string, operator: OperatorIdentity): void {
  let st: ReturnType<typeof lstatSync>
  try {
    st = lstatSync(path)
  } catch {
    throw refuse(`${what} cannot be read`)
  }
  if (st.isSymbolicLink()) throw refuse(`${what} is a link; it is not followed`)
  if (!st.isDirectory()) throw refuse(`${what} is not a folder`)
  if (process.platform === "win32") return
  if (operator.uid !== null && st.uid !== operator.uid) throw refuse(`${what} is not owned by this user`)
  if ((st.mode & 0o022) !== 0) throw refuse(`${what} is writable by others`)
}

/** The vault folder, the internal folder and the conflict folder, judged for the operator. A folder that does not exist yet is not judged. */
export function assertOperatorFolders(root: string, operator: OperatorIdentity): void {
  const real = realOrNull(root)
  if (real === null) throw refuse("the vault folder cannot be read")
  assertOwnedFolder(real, "the vault folder", operator)
  const internal = join(root, ".unifia")
  if (entryPresent(internal)) assertOwnedFolder(internal, "the vault's internal folder", operator)
  const conflicts = join(root, CONFLICTS_DIR)
  if (entryPresent(conflicts)) assertOwnedFolder(conflicts, "the conflict folder", operator)
}

/** Make a folder for the conflict records, owner-only, or check the one that is there. */
function ensurePrivateFolder(path: string, what: string, operator: OperatorIdentity): void {
  if (entryPresent(path)) {
    assertOwnedFolder(path, what, operator)
    return
  }
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 })
  } catch {
    throw refuse(`${what} cannot be created`)
  }
  assertOwnedFolder(path, what, operator)
}

/**
 * Create a file that must not exist, with owner-only permissions, and flush it. An exclusive create never follows a link: a link at
 * the name makes the create fail, and nothing is written through it.
 */
function writeNewPrivate(path: string, bytes: Buffer | string): void {
  let fd: number
  try {
    fd = openSync(path, "wx", 0o600)
  } catch {
    throw refuse("a file is already present where this record would go; it is not replaced")
  }
  try {
    writeSync(fd, typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// -- the decisions file ---------------------------------------------------------------------------------------------------------

/**
 * Every decision in the file, in order. A torn final line, as an interrupted append leaves, is skipped; a file that is a link or
 * not a file of its own is refused, and never read through.
 */
export function readDecisions(root: string): DecisionEvent[] {
  const read = readNoFollow(join(root, DECISIONS_FILE))
  if (read.kind === "absent") return []
  if (read.kind !== "file") throw refuse("the decisions file is not read: it is not a file of its own")
  const out: DecisionEvent[] = []
  for (const line of read.text.split("\n")) {
    if (line.trim() === "") continue
    try {
      const value = JSON.parse(line) as unknown
      if (typeof value === "object" && value !== null && !Array.isArray(value)) out.push(value as DecisionEvent)
    } catch {
      // A torn line: an append that a crash interrupted. The entries before it stand.
    }
  }
  return out
}

/** Append one decision. The file is created owner-only when it does not exist, and only ever appended to after that. */
export function appendDecision(root: string, event: DecisionEvent, operator: OperatorIdentity): void {
  ensurePrivateFolder(join(root, CONFLICTS_DIR), "the conflict folder", operator)
  const file = join(root, DECISIONS_FILE)
  if (!entryPresent(file)) writeNewPrivate(file, "")
  appendLineDurable(file, JSON.stringify(event))
}

/**
 * The applies that started and did not finish: for each conflict, its last apply start-or-completion is a start. A refusal does not
 * close one: a refused apply changed nothing, and an interrupted one may have changed the vault.
 */
export function interruptedIn(events: readonly DecisionEvent[]): ApplyEvent[] {
  const last = new Map<string, ApplyEvent>()
  for (const event of events) {
    if (event.event === "apply-started" || event.event === "apply-completed") last.set(event.conflictId, event)
  }
  return [...last.values()].filter((event) => event.event === "apply-started")
}

/** The interrupted applies of the vault's decisions file. */
function interruptedApplies(root: string): ApplyEvent[] {
  return interruptedIn(readDecisions(root))
}

/** The notes with an apply that is interrupted, as vault-relative locators. */
export function openApplyLocators(root: string): string[] {
  return interruptedApplies(root).map((event) => event.locator)
}

/** Whether the note at `locator` has an interrupted apply: its writes are refused until the apply is finished. */
export function hasOpenApply(root: string, locator: string): boolean {
  const key = recoveryKey(locator)
  return openApplyLocators(root).some((open) => recoveryKey(open) === key)
}

// -- the record -----------------------------------------------------------------------------------------------------------------

/** The record folder of a conflict. The id is judged first, so that no identifier names a path it did not come from. */
function recordDirOf(root: string, id: string): string {
  assertConflictId(id)
  return join(root, CONFLICTS_DIR, id)
}

/**
 * Create the record of a conflict that recovery left in place, if it has none. Its facts are those at detection. Nothing in an
 * existing record is changed.
 */
export function ensureRecord(root: string, fact: ConflictFact, operator: OperatorIdentity = currentOperator()): void {
  ensurePrivateFolder(join(root, CONFLICTS_DIR), "the conflict folder", operator)
  const dir = recordDirOf(root, fact.id)
  ensurePrivateFolder(dir, "the record folder", operator)
  const file = join(dir, RECORD_FILE)
  if (entryPresent(file)) return
  const record = {
    format: 1,
    id: fact.id,
    locator: fact.locator,
    operation: fact.operation,
    seq: fact.seq,
    auditId: fact.auditId,
    pendingHash: fact.pending.hash,
    pendingSize: fact.pending.size,
    currentHash: fact.current.state === "file" ? fact.current.hash : null,
    detectedAt: new Date().toISOString(),
  }
  writeNewPrivate(file, `${JSON.stringify(record, null, 2)}\n`)
}

/** Create the record of every conflict the vault holds now. Called by the writer after recovery leaves a conflict. */
export function recordPendingConflicts(root: string, walFile: string): void {
  for (const fact of scanConflicts(root, walFile)) ensureRecord(root, fact)
}

/** Refuse a record folder, or a preservation folder, that is a link or not a folder of the operator's. Before any step of an apply. */
export function assertRecordFolders(root: string, id: string, operator: OperatorIdentity): void {
  const dir = recordDirOf(root, id)
  assertOwnedFolder(dir, "the record folder", operator)
  const preserved = join(dir, PRESERVED_DIR)
  if (entryPresent(preserved)) assertOwnedFolder(preserved, "the preservation folder", operator)
}

/** The vault-relative place of a preserved version: its role (`current` or `pending`) and its hash, inside the conflict's record. */
export function preservedRelOf(id: string, role: "current" | "pending", hash: string): string {
  return `${CONFLICTS_DIR}/${id}/${PRESERVED_DIR}/${role}-${hash}.md`
}

/**
 * Keep a version a resolution does not keep, in the conflict's record, under its role and hash. The copy is written beside its
 * name, flushed, read back and verified, and only then named: a crash before the name leaves nothing that looks preserved.
 * A copy already present with these bytes is kept as it is; one with other bytes is refused, never replaced.
 */
export function preserveVersion(
  root: string,
  id: string,
  role: "current" | "pending",
  bytes: Buffer,
  hash: string,
  operator: OperatorIdentity,
): string {
  const dir = join(recordDirOf(root, id), PRESERVED_DIR)
  ensurePrivateFolder(dir, "the preservation folder", operator)
  const rel = preservedRelOf(id, role, hash)
  const held = inspectFile(root, rel)
  if (held.state === "file") {
    if (held.hash === hash) return rel
    throw refuse("a preserved copy with other bytes is already present; it is not replaced")
  }
  if (held.state !== "absent") throw refuse("the preservation place is a link or not a file of its own; it is not replaced")

  const partial = `${rel}.partial`
  const stale = inspectFile(root, partial)
  if (stale.state === "link" || stale.state === "other") throw refuse("the preservation place is a link or not a file of its own; it is not replaced")
  // A partial copy is the bytes of a crashed copy, and the bytes it copies are still in their place: it is replaced.
  if (stale.state === "file") unlinkSync(join(root, partial))
  writeNewPrivate(join(root, partial), bytes)
  const written = inspectFile(root, partial)
  if (written.state !== "file" || written.hash !== hash) throw refuse("the preserved copy did not verify; nothing was replaced")
  renameDurable(join(root, partial), join(root, rel))
  fsyncDirectory(dir)
  return rel
}

// -- the note's identity --------------------------------------------------------------------------------------------------------

/**
 * The same note, with a new `unifia_id` on its identity line and no other byte changed. A conflict kept as a note of its own
 * must not share the identity of the note it came from, or the vault holds two notes with one id. Null when the text has no
 * frontmatter identity line to change.
 */
export function withNoteIdentity(text: string, id: string): string | null {
  const lines = text.split("\n")
  if ((lines[0] ?? "").replace(/\r$/, "") !== "---") return null
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ""
    if (line.replace(/\r$/, "") === "---") return null
    if (/^unifia_id:/.test(line)) {
      lines[i] = `unifia_id: "${id}"${line.endsWith("\r") ? "\r" : ""}`
      const out = lines.join("\n")
      try {
        return parseFrontmatter(out).frontmatter.unifia_id === id ? out : null
      } catch {
        return null
      }
    }
  }
  return null
}
