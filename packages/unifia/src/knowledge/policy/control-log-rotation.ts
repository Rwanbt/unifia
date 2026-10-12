/* SPDX-License-Identifier: MIT */
/**
 * Writing the Class C control log: the append, and the rotation that keeps a
 * bounded set of generations. The layout and the chain are in
 * control-log-generations.ts; this module changes only what is on disk, and it
 * is called with the write lock held.
 *
 * ## Rotation, in the order it reaches the disk
 *
 *   1. the next active generation (a header and nothing else) is written to a
 *      temporary file and fsynced;
 *   2. the active file is renamed to its archive name, and the folder fsynced
 *      ("sealed");
 *   3. the temporary is renamed to the active name, and the folder fsynced
 *      ("committed");
 *   4. the oldest archives beyond N are removed, and the folder fsynced
 *      ("pruned"). This runs before the batch is appended, so a crash here
 *      leaves the batch unwritten and its decisions still pending.
 *
 * A crash before 2 leaves the old set; the temporary holds no events and the
 * next write discards it. A crash between 2 and 3 leaves no active file, and
 * the complete temporary is the active generation the next write commits. A
 * crash after 3 leaves N + 1 generations; the next write removes the oldest,
 * and readers already leave it out. Nothing is removed before the new set is in
 * place, and a rename never overwrites: a target that exists is refused.
 *
 * ## Recovery and reads
 *
 * Every write begins by settling a rotation that a crash left behind. A read
 * repairs nothing: a reader takes the temporary generation as the active one
 * when the active file is missing, and the verifier reports what it sees.
 *
 * ## Restricted access
 *
 * A file this module creates is created owner-only (0600). A legacy generation
 * that is adopted is tightened to 0600 too. Where the platform does not keep
 * modes (Windows) the file keeps the access of its folder, which is not
 * verified here.
 */

import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"
import type { EgressAuditEntry } from "./audit.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { appendLineDurable, ensureFolder, fsyncDirectory, readNoFollow, renameDurable } from "../mutation/durability.js"
import {
  ACTIVE_NAME,
  GENESIS,
  TEMP_NAME,
  archiveIndexOf,
  archiveName,
  entryLine,
  headerLine,
  headerOfText,
  lastChainedOf,
  legacyHeadOfText,
  sha256,
  type ChainHead,
  type GenerationHeader,
} from "./control-log-generations.js"

/** The points at which a rotation can be interrupted. Tests use them to inject a crash. */
export type RotationStep = "temp-written" | "sealed" | "committed" | "pruned"

export interface WriterHooks {
  onRotationStep?: (step: RotationStep) => void
}

export interface WriterLimits {
  rotateAtBytes: number
  generations: number
}

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0
const NO_BLOCK = constants.O_NONBLOCK ?? 0
/** The header of a generation is far shorter than this; a legacy first line is cut here and then judged as not a header. */
const FIRST_LINE_BYTES = 4096
/** Enough of the end of the active file to find its last entry, without reading the whole of it on every write. */
const TAIL_BYTES = 64 * 1024
const REFUSED = "the egress control log cannot be rotated"

interface ActiveView {
  size: number
  /** The first line, or the first bytes of it when it is longer than the read. */
  first: string
  tail: string
  tailStart: number
}

function refuse(message: string = REFUSED): never {
  throw KnowledgeFailure.mutationRefused(message)
}

/**
 * Append a batch to the active generation, rotating first when it is full or
 * when it is not yet in the new format. The caller holds the write lock.
 */
export function appendBatch(
  dir: string,
  batch: readonly EgressAuditEntry[],
  limits: WriterLimits,
  hooks: WriterHooks,
): void {
  ensureFolder(dir)
  settleTemporary(dir)
  const view = viewOf(join(dir, ACTIVE_NAME))
  const head =
    view === null
      ? startGeneration(dir, hooks)
      : needsRotation(view, limits)
        ? rotate(dir, view, hooks)
        : chainHeadOf(dir, view)
  pruneOldest(dir, limits, hooks)
  appendLines(dir, batch, head)
}

function needsRotation(view: ActiveView, limits: WriterLimits): boolean {
  return headerOfText(firstLineOf(view.first)) === null || view.size >= limits.rotateAtBytes
}

/** A rotation a crash interrupted: the temporary is discarded beside an active file, or committed when the active file is gone. */
function settleTemporary(dir: string): void {
  const temp = join(dir, TEMP_NAME)
  if (!present(temp)) return
  if (present(join(dir, ACTIVE_NAME))) {
    unlinkSync(temp)
    fsyncDirectory(dir)
    return
  }
  // The active file was sealed and the commit did not happen: the temporary is the next active generation, but only if it continues the newest archive.
  const header = headerOfText(firstLineOf(readOwnText(temp)))
  if (header === null || header.index !== expectedNext(dir)) refuse()
  renameDurable(temp, join(dir, ACTIVE_NAME))
  fsyncDirectory(dir)
}

/** The first active generation of a trail: a fresh one, or the adoption of a legacy archive that has no successor. */
function startGeneration(dir: string, hooks: WriterHooks): ChainHead {
  const newest = newestArchive(dir)
  const header: GenerationHeader =
    newest === null ? { index: 1, firstSeq: 1, continues: GENESIS } : adoptNewest(dir, newest)
  createTemporary(dir, headerLine(header))
  hooks.onRotationStep?.("temp-written")
  renameDurable(join(dir, TEMP_NAME), join(dir, ACTIVE_NAME))
  fsyncDirectory(dir)
  hooks.onRotationStep?.("committed")
  return { seq: header.firstSeq - 1, hash: header.continues }
}

/**
 * The newest archive has no active successor. A legacy archive is adopted: the
 * next generation continues from its last line. A chained archive means the
 * active generation was removed from outside, and that is refused, not papered over.
 */
function adoptNewest(dir: string, newest: number): GenerationHeader {
  const path = join(dir, archiveName(newest))
  const text = readOwnText(path)
  if (headerOfText(firstLineOf(text)) !== null) refuse("the active generation of the egress control log is missing")
  tightenMode(path)
  return { index: newest + 1, firstSeq: 1, continues: legacyHeadOfText(text) }
}

/** Seal the active generation and make a new one. Returns the head the new generation starts from. */
function rotate(dir: string, view: ActiveView, hooks: WriterHooks): ChainHead {
  const legacy = headerOfText(firstLineOf(view.first)) === null
  const sealIndex = legacy ? expectedNext(dir) : sealIndexOf(view.first)
  if (sealIndex !== expectedNext(dir)) refuse()
  refuseIfPresent(join(dir, archiveName(sealIndex)))
  const head: ChainHead = legacy
    ? { seq: 0, hash: legacyHeadOfText(readOwnText(join(dir, ACTIVE_NAME))) }
    : chainHeadOf(dir, view)
  const next: GenerationHeader = { index: sealIndex + 1, firstSeq: head.seq + 1, continues: head.hash }
  createTemporary(dir, headerLine(next))
  hooks.onRotationStep?.("temp-written")
  if (legacy) tightenMode(join(dir, ACTIVE_NAME))
  renameDurable(join(dir, ACTIVE_NAME), join(dir, archiveName(sealIndex)))
  fsyncDirectory(dir)
  hooks.onRotationStep?.("sealed")
  renameDurable(join(dir, TEMP_NAME), join(dir, ACTIVE_NAME))
  fsyncDirectory(dir)
  hooks.onRotationStep?.("committed")
  return { seq: next.firstSeq - 1, hash: next.continues }
}

function sealIndexOf(first: string): number {
  const header = headerOfText(firstLineOf(first))
  if (header === null) refuse()
  return header.index
}

/** The head the active generation ends on: its last entry, or its header when it holds none yet. */
function chainHeadOf(dir: string, view: ActiveView): ChainHead {
  const inTail = lastChainedOf(view.tail, view.tailStart > 0)
  if (inTail !== null) return inTail
  const whole = view.tailStart > 0 ? readOwnText(join(dir, ACTIVE_NAME)) : view.tail
  const inWhole = lastChainedOf(whole, false)
  if (inWhole !== null) return inWhole
  const header = headerOfText(firstLineOf(view.first))
  if (header === null) refuse()
  return { seq: header.firstSeq - 1, hash: header.continues }
}

/** Remove the oldest archives while more than N generations exist. Only after the new set is in place, and never the active one. */
function pruneOldest(dir: string, limits: WriterLimits, hooks: WriterHooks): void {
  if (!present(join(dir, ACTIVE_NAME))) return
  const indexes = archiveIndexes(dir)
  let excess = indexes.length + 1 - limits.generations
  for (const index of indexes) {
    if (excess <= 0) break
    unlinkSync(join(dir, archiveName(index)))
    fsyncDirectory(dir)
    excess -= 1
    hooks.onRotationStep?.("pruned")
  }
}

/** Each entry takes the next sequence number and the hash of the line before it. The batch is one durable append. */
function appendLines(dir: string, batch: readonly EgressAuditEntry[], start: ChainHead): void {
  let seq = start.seq
  let hash = start.hash
  const lines = batch.map((entry) => {
    seq += 1
    const line = entryLine(entry, seq, hash)
    hash = sha256(line)
    return line
  })
  appendLineDurable(join(dir, ACTIVE_NAME), lines.join("\n"))
}

/** The index the next generation must carry: one past the newest archive, or 1 for a fresh trail. */
function expectedNext(dir: string): number {
  return (newestArchive(dir) ?? 0) + 1
}

function newestArchive(dir: string): number | null {
  const indexes = archiveIndexes(dir)
  return indexes.length === 0 ? null : (indexes[indexes.length - 1] ?? null)
}

function archiveIndexes(dir: string): number[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    refuse()
  }
  return names
    .map((name) => archiveIndexOf(name))
    .filter((index): index is number => index !== null)
    .sort((a, b) => a - b)
}

/**
 * Create the temporary generation exclusively, owner-only, and flush it. An
 * existing file is refused, never reused: a temporary is always settled first.
 */
function createTemporary(dir: string, line: string): void {
  const path = join(dir, TEMP_NAME)
  refuseIfPresent(path)
  let fd: number
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600)
  } catch {
    refuse()
  }
  try {
    writeSync(fd, `${line}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Read the active file's first line, its size, and the last bytes of it, refusing a link or a file with a second name. */
function viewOf(path: string): ActiveView | null {
  if (NO_FOLLOW === 0 && linked(path)) refuse()
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW | NO_BLOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    refuse()
  }
  try {
    return readView(fd)
  } finally {
    closeSync(fd)
  }
}

function readView(fd: number): ActiveView {
  const stats = fstatSync(fd)
  if (!stats.isFile() || stats.nlink > 1) refuse()
  const size = stats.size
  const first = readRange(fd, 0, Math.min(size, FIRST_LINE_BYTES))
  const tailStart = Math.max(0, size - TAIL_BYTES)
  const newline = first.indexOf("\n")
  return {
    size,
    first: newline === -1 ? first : first.slice(0, newline),
    tailStart,
    tail: readRange(fd, tailStart, size - tailStart),
  }
}

function readRange(fd: number, start: number, length: number): string {
  const buffer = Buffer.alloc(length)
  const read = readSync(fd, buffer, 0, length, start)
  return buffer.toString("utf8", 0, read)
}

/** Whole-file text, read without following a link. */
function readOwnText(path: string): string {
  const read = readNoFollow(path)
  if (read.kind !== "file") refuse()
  return read.text
}

function firstLineOf(text: string): string {
  const newline = text.indexOf("\n")
  return newline === -1 ? text : text.slice(0, newline)
}

/** Whether a path exists, looking at the link itself. */
function present(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function refuseIfPresent(path: string): void {
  if (present(path)) refuse()
}

/** Windows has no no-follow open, so a link is looked for first. The gap is the residual ADR-092 records. */
function linked(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** Owner-only where the platform keeps modes. A failure leaves the file as it is: nothing here is worth a failed write. */
function tightenMode(path: string): void {
  try {
    chmodSync(path, 0o600)
  } catch {
    // The platform does not keep modes here, or the file is not ours to change.
  }
}
