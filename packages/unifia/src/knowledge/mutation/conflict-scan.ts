/* SPDX-License-Identifier: MIT */
/**
 * The conflicts recovery leaves in a vault, read and never changed.
 *
 * A conflict is a pending temporary that recovery kept in place: the destination holds neither the bytes the write replaced nor
 * the bytes the log expects. Its id is a function of the note, the sequence number of the WAL entry whose bytes the temporary
 * holds, and the hash of those bytes, so the same crash always gives the same id.
 *
 * The judgement is recovery's own (`listPendingConflicts`). This module reads only what that judgement names: the pending entry,
 * the newest entry for the note, and the two versions. Every version is read through the handle-checked reader after a look at
 * the path that does not follow a link; a link, a pipe, a device or a file with a second name is reported and never read.
 */

import { createHash } from "node:crypto"
import { lstatSync } from "node:fs"
import { join } from "node:path"
import type { WalEntry, WalKind } from "../wal/wal.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { TMP_SUFFIX, listPendingConflicts, readWalTolerant, recoveryKey } from "./durability.js"
import { isContained, realOrNull } from "../source/containment.js"
import { readContainedBytesByHandleSync } from "../source/vault.js"

/** SHA-256 hex of bytes, or of a string's UTF-8 bytes. The writer hashes a version the same way. */
export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** What is at a vault path. A link, a non-file or a file with a second name is reported and its bytes are not read. */
export type FileState =
  | { state: "absent" }
  | { state: "link" }
  | { state: "other" }
  | { state: "file"; bytes: Buffer; hash: string; size: number }

/** What is at `root/locator`, judged without following a link. The bytes are read only for a file of its own, inside the vault. */
export function inspectFile(root: string, locator: string): FileState {
  const full = join(root, locator)
  let st: ReturnType<typeof lstatSync>
  try {
    st = lstatSync(full)
  } catch {
    return { state: "absent" }
  }
  if (st.isSymbolicLink()) return { state: "link" }
  if (!st.isFile() || st.nlink > 1) return { state: "other" }
  const realRoot = realOrNull(root)
  const real = realOrNull(full)
  if (realRoot === null || real === null || !isContained(realRoot, real)) return { state: "other" }
  const bytes = readContainedBytesByHandleSync(real, locator)
  if (bytes === null) return { state: "absent" }
  return { state: "file", bytes, hash: sha256Hex(bytes), size: bytes.length }
}

/** One conflict as the vault holds it now. */
export interface ConflictFact {
  id: string
  /** The note, as a vault-relative locator with `/` separators. */
  locator: string
  /** The kind of the pending WAL entry, or null when no entry records the pending bytes (a destination that is a link). */
  operation: WalKind | null
  seq: number | null
  auditId: string | null
  source: string | null
  reason: string | null
  timestamp: string | null
  /** The newest WAL entry that touches the note. */
  lastSeq: number | null
  /** The newest entry, when it is not the pending one: a later write, delete or move of the note. */
  later: { seq: number; kind: WalKind } | null
  pending: { bytes: Buffer; hash: string; size: number }
  current: FileState
}

/** The id of a conflict: the note, the pending entry's sequence number, and the pending bytes' hash, truncated to 16 hex digits. */
function conflictIdOf(locator: string, seq: number | null, pendingHash: string): string {
  return sha256Hex(`${locator}\n${seq ?? "-"}\n${pendingHash}`).slice(0, 16)
}

/** Every conflict the vault holds, sorted by locator. Reads the vault and its log; changes neither. */
export function scanConflicts(root: string, walFile: string): ConflictFact[] {
  const locators = listPendingConflicts(root, walFile)
  if (locators.length === 0) return []
  const entries = readWalTolerant(join(root, walFile)).entries.filter((e) => typeof e.locator === "string")
  return locators.map((locator) => factOf(root, locator, entries))
}

function factOf(root: string, locator: string, entries: WalEntry[]): ConflictFact {
  const pendingState = inspectFile(root, `${locator}${TMP_SUFFIX}`)
  if (pendingState.state !== "file") {
    throw KnowledgeFailure.mutationRefused("a held write changed while it was read; list the conflicts again")
  }
  const pendingHash = pendingState.hash
  const key = recoveryKey(locator)
  // The pending entry is the newest one for the note whose bytes are the temporary's, as recovery judges it.
  const own = entries.filter((e) => e.newHash !== null && e.newHash === pendingHash && recoveryKey(e.locator) === key).at(-1)
  const touching = entries.filter(
    (e) =>
      recoveryKey(e.locator) === key || (typeof e.previousLocator === "string" && recoveryKey(e.previousLocator) === key),
  )
  const last = touching.at(-1)
  return {
    id: conflictIdOf(locator, own?.seq ?? null, pendingHash),
    locator,
    operation: own?.kind ?? null,
    seq: own?.seq ?? null,
    auditId: own?.auditId ?? null,
    source: own?.source ?? null,
    reason: own?.reason ?? null,
    timestamp: own?.timestamp ?? null,
    lastSeq: last?.seq ?? null,
    later: last !== undefined && last !== own ? { seq: last.seq, kind: last.kind } : null,
    pending: { bytes: pendingState.bytes, hash: pendingHash, size: pendingState.size },
    current: inspectFile(root, locator),
  }
}
