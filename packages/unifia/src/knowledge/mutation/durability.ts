/* SPDX-License-Identifier: MIT */
/**
 * Durability primitives for Class A writes (card C31).
 *
 * The writer wrote a temporary file, appended a WAL line and renamed. None of
 * the three was flushed, nothing serialised two writers, and nothing
 * reconciled a crash — so a power loss could leave a WAL entry with no file,
 * a file with no entry, or two processes reusing one sequence number.
 *
 * The commit invariant this module implements:
 *
 *   1. the temporary file is written and **fsynced** — its bytes are on disk;
 *   2. the WAL line is appended and **fsynced** — the intent is durable;
 *   3. the rename makes it visible — atomic on both NTFS and POSIX;
 *   4. the directory is fsynced where the platform supports it.
 *
 * "Committed" means step 2 completed: the WAL is the record of truth. A crash
 * before it leaves an orphan temporary and no entry — nothing happened. A
 * crash between 2 and 3 leaves an entry whose target does not yet match, and
 * recovery finishes the rename. That asymmetry is deliberate: it is always
 * safe to redo a rename, never safe to invent a WAL entry.
 */

import {
  type Dirent,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { basename, dirname, join, normalize, relative, sep } from "node:path"
import { createHash } from "node:crypto"
import type { WalEntry } from "../wal/wal.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { isInternalLocator, realOrNull, wouldBeContained } from "../source/containment.js"

// The vault's own folder is judged where the vault's reader and writer judge it: the definition lives with the containment rules.
export { isInternalLocator } from "../source/containment.js"

/** Suffix that marks a not-yet-visible write. */
export const TMP_SUFFIX = ".unifia-tmp"

/** A lock older than this is treated as abandoned by a dead process. */
export const LOCK_STALE_MS = 30_000

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

/**
 * Create the folder `path`, and its parents. The operating system's message would carry the absolute path of the vault,
 * which is not for the model to see, so the failure is refused without it.
 */
export function ensureFolder(path: string): void {
  try {
    mkdirSync(path, { recursive: true })
  } catch {
    throw KnowledgeFailure.mutationRefused("the folder of this write cannot be created")
  }
}

/**
 * Create a new file with `content`, and flush it. The file is created exclusively: whatever is already at the path, a
 * regular file or a link, even a dangling one, makes the write fail and nothing is written. This is the temporary file
 * of a commit, whose name a link could be planted at inside the vault; following it would write to its target.
 *
 * The refusal names no path: the operating system's message would carry the absolute path of the vault.
 */
export function writeNewFileDurable(path: string, content: string): void {
  // Refused before the create where links are not refused by the flag: on Windows an exclusive create at a dangling link
  // creates the link's target outside the vault.
  if (isLinkNow(path)) throw KnowledgeFailure.mutationRefused("a file is already present where this write would go; it is not replaced")
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch {
    throw KnowledgeFailure.mutationRefused("the folder of this write is not a folder the vault can use")
  }
  let fd: number
  try {
    fd = openSync(path, "wx")
  } catch {
    throw KnowledgeFailure.mutationRefused("a file is already present where this write would go; it is not replaced")
  }
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Write `content` and flush it to the physical device before returning. */
export function writeFileDurable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
  const fd = openSync(path, "r+")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Append `line` to `path` and flush it.
 *
 * A crash mid-append leaves a partial line with no terminating newline. The
 * next append must not run into it: without the separator below, the torn
 * tail and the new entry concatenate into one unparseable line, so a single
 * interrupted write would corrupt the *next* one too.
 */
export function appendLineDurable(path: string, line: string): void {
  ensureFolder(dirname(path))
  if (isLinkNow(path)) throw KnowledgeFailure.mutationRefused("the log cannot be written through a link")
  // Where the platform has O_NOFOLLOW, the open refuses a link in the same call that opens it; on Windows `isLinkNow` above
  // is the look before it. A link here would send the entry to wherever it points, outside the vault, so the open is refused.
  let fd: number
  try {
    fd = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | NO_FOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw KnowledgeFailure.mutationRefused("the log cannot be written through a link")
    }
    // Any other failure names no path: the operating system's message would carry the absolute path of the vault.
    throw KnowledgeFailure.mutationRefused("the log cannot be written")
  }
  try {
    // A file with a second name has the same bytes elsewhere too: an entry appended to it lands outside the vault as well.
    const stats = fstatSync(fd)
    if (!stats.isFile() || stats.nlink > 1) {
      throw KnowledgeFailure.mutationRefused("the log cannot be written: it is not a file of its own")
    }
    const size = stats.size
    let needsSeparator = false
    if (size > 0) {
      const tail = Buffer.alloc(1)
      readSync(fd, tail, 0, 1, size - 1)
      needsSeparator = tail[0] !== 0x0a
    }
    writeSync(fd, `${needsSeparator ? "\n" : ""}${line}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Flush a directory entry so a rename survives a power loss.
 *
 * Windows does not allow opening a directory for fsync; the rename is already
 * ordered there, so the failure is expected and ignored rather than reported
 * as an error the operator can do nothing about.
 */
export function fsyncDirectory(path: string): void {
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch {
    return
  }
  try {
    fsyncSync(fd)
  } catch {
    // Directory fsync is not supported on this platform.
  } finally {
    closeSync(fd)
  }
}

/** Errors a Windows rename raises when a handle is still open on the target. */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"])

/** How long `renameDurable` keeps retrying a transient Windows refusal. */
const RENAME_RETRY_BUDGET_MS = 2_000
const RENAME_RETRY_POLL_MS = 5

/** Block the thread for `ms`. The write path is synchronous by contract. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Rename `from` over `to`, tolerating Windows' open-handle refusals.
 *
 * POSIX `rename` replaces the destination whatever else holds it open.
 * Windows does not: while any process has a handle on `to` — a concurrent
 * reader, an antivirus scanner, the search indexer — `MoveFileEx` fails with
 * `EPERM`, and the write is lost even though the temporary was complete and
 * fsynced. Measured here at roughly one publish in five with four processes
 * writing one small file.
 *
 * Retrying briefly is the remedy every Windows-targeting tool converges on.
 * It is bounded: a destination held open indefinitely is a real failure and
 * still surfaces as one, rather than hanging the caller.
 */
export function renameDurable(from: string, to: string): void {
  const deadline = Date.now() + RENAME_RETRY_BUDGET_MS
  for (;;) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ""
      // The operating system's message would carry both absolute paths: the failure names neither.
      if (!TRANSIENT_RENAME_CODES.has(code) || Date.now() >= deadline) throw KnowledgeFailure.mutationRefused("the write could not be committed")
      sleepSync(RENAME_RETRY_POLL_MS)
    }
  }
}

/**
 * Liveness verdict for a recorded PID.
 *
 * - `alive`   : the kernel confirmed the process exists (signal 0 succeeded
 *                or `EPERM` was raised). The holder is real.
 * - `dead`    : the kernel confirmed the process is gone (`ESRCH`). Safe
 *                to reclaim immediately.
 * - `unknown` : the PID is not a candidate for the kernel check at all
 *                (non-integer, non-positive, or our own pid surfaced in an
 *                odd place). The caller must fall back to a different
 *                policy, never to "steal the lock".
 */
export type PidLiveness = "alive" | "dead" | "unknown"

/**
 * Best-effort liveness check for `pid`.
 *
 * Signal 0 on POSIX and the existence check on Windows behave the same
 * way for this purpose: both throw `ESRCH` for a non-existent pid.
 *
 * `unknown` is returned for pids that should not reach the kernel: a
 * zero, a negative, a non-integer, or a value larger than any pid the
 * kernel would ever allocate (the signed 32-bit max). The conservative
 * policy is: if we cannot prove the holder is dead, do not steal the
 * lock.
 */
export function pidLiveness(pid: number): PidLiveness {
  if (!Number.isInteger(pid) || pid <= 0) return "unknown"
  if (pid > 0x7fffffff) return "unknown"
  if (pid === process.pid) return "alive"
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (e) {
    const code = (e as { code?: string } | null)?.code
    if (code === "ESRCH") return "dead"
    if (code === "EPERM") return "alive"
    return "unknown"
  }
}

/**
 * True iff `pid` is verifiably alive. Kept for tests and for callers
 * that want a simple boolean (true iff "alive", false otherwise).
 */
export function isPidAlive(pid: number): boolean {
  return pidLiveness(pid) === "alive"
}

/**
 * The pid recorded in a lock file's text, if any.
 *
 * The lock file is `{ pid, at }` written as JSON. Returns `null` if the
 * text cannot be parsed, so the caller can fall back to the time-only
 * heuristic.
 */
function lockPidOf(text: string): number | null {
  try {
    const parsed = JSON.parse(text) as { pid?: unknown }
    if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid)) {
      return parsed.pid
    }
    return null
  } catch {
    return null
  }
}

/** The sequence number a lock records for the move or restore its holder was appending, or null when it records none. */
function lockSeqOf(text: string | null): number | null {
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as { seq?: unknown }
    return typeof parsed.seq === "number" && Number.isInteger(parsed.seq) ? parsed.seq : null
  } catch {
    return null
  }
}

/** What an acquisition found. `inFlightSeq` is the sequence number a reclaimed dead holder recorded for its move, if it recorded one. */
export interface LockAcquisition {
  reclaimed: boolean
  inFlightSeq: number | null
}

/**
 * Exclusive, cross-process write lock.
 *
 * `O_EXCL` makes acquisition atomic even between processes. The holder's pid
 * and timestamp are recorded so a lock left by a crashed process can be
 * reclaimed instead of blocking the vault forever.
 *
 * Reclaim is *liveness-first*: a lock held by a process whose pid is still
 * alive is never stolen, even if its mtime is older than `LOCK_STALE_MS`.
 * The time heuristic is the fallback for locks we cannot read, or whose
 * recorded pid is unverifiable (corrupt file, pid from a previous boot,
 * cross-platform state).
 *
 * The lock is *reentrant*, counted by `depth`. An operation that spans
 * several writes — `supersede` touches two notes — takes the lock once
 * and calls `commit` under it; `commit` takes the same lock again. With a
 * boolean flag the inner `release` unlinked the lock file while the outer
 * operation was still running, so a second writer could land between the
 * successor's write and the target's. The counter makes the physical lock
 * live exactly as long as the outermost `withLock`.
 */
export class WriteLock {
  /**
   * Number of nested `acquire()` calls currently outstanding. The lock file
   * exists on disk for `depth > 0` and only for that span.
   */
  private depth = 0

  /** The `at` this holder wrote into the lock file it created. With the pid, it identifies the holder's lock. */
  private heldAt: string | null = null

  /** The text of a dead holder's lock that the last acquisition removed, if it removed one. */
  private reclaimedText: string | null = null

  constructor(
    private readonly path: string,
    private readonly hooks: WriteLockHooks = {},
  ) {}

  /**
   * Take the lock. Returns `reclaimed: true` when the lock was taken over from a dead or stale holder, which is the only sign
   * that a writer died mid-commit: a lock that was simply free says nothing about a crash.
   */
  acquire(): LockAcquisition {
    if (this.depth > 0) {
      this.depth += 1
      return { reclaimed: false, inFlightSeq: null }
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true })
    } catch {
      // The operating system's message would carry the absolute path of the vault: the failure names none.
      throw KnowledgeFailure.mutationRefused("the vault cannot be locked for writing")
    }
    // Two attempts: one, and one more after reclaiming a dead holder's lock.
    //
    // The second `create` used to be unguarded, on the assumption that
    // reclaiming entitles us to the lock. It does not: between the reclaim
    // and the create, a third process can take it. `openSync(path, "wx")`
    // then threw a raw `EEXIST` straight out of `acquire`, past the typed
    // refusal every caller branches on — so contention surfaced as a
    // filesystem crash instead of "the vault is busy", and callers that
    // retry on contention could not recognise it. Guarding both attempts
    // the same way means every loss of the race leaves by the same door.
    let reclaimed = false
    this.reclaimedText = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.create()
        this.depth = 1
        return { reclaimed, inFlightSeq: lockSeqOf(this.reclaimedText) }
      } catch {
        const verdict = attempt === 0 ? this.reclaimIfStale() : "held"
        if (verdict === "held") break
        if (verdict === "reclaimed") reclaimed = true
      }
    }
    throw KnowledgeFailure.mutationRefused("vault is locked by another writer")
  }

  release(): void {
    if (this.depth === 0) return
    this.depth -= 1
    // An inner release only unwinds the counter: the file stays until the
    // outermost holder lets go, so no window opens mid-operation.
    if (this.depth > 0) return
    // Only the lock this holder wrote is removed. A lock another holder wrote in its place is left as it is.
    const ours = this.holdsLockFile()
    this.heldAt = null
    if (!ours) return
    try {
      unlinkSync(this.path)
    } catch {
      // Already gone; the lock is free either way.
    }
  }

  /**
   * Give up the lock when the work done under it did not return. A lock this holder reclaimed is put back as the dead holder left it,
   * so the crash it records stays on record for the next open. A lock this holder created is removed, as `release` removes it.
   */
  abandon(): void {
    if (this.depth === 0) return
    const judged = this.reclaimedText
    const ours = this.holdsLockFile()
    this.depth = 0
    this.heldAt = null
    this.reclaimedText = null
    if (!ours) return
    try {
      if (judged !== null) writeFileDurable(this.path, judged)
      else unlinkSync(this.path)
    } catch {
      // Neither could be done: the next open finds a lock held by this process, and reports the vault as busy.
    }
  }

  /** True while this instance physically holds the lock file. */
  get isHeld(): boolean {
    return this.depth > 0
  }

  /** Run `work` while holding the lock, releasing it whatever happens. */
  withLock<T>(work: () => T): T {
    this.acquire()
    try {
      return work()
    } finally {
      this.release()
    }
  }

  private create(): void {
    const at = new Date().toISOString()
    const fd = openSync(this.path, "wx")
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, at }))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    this.heldAt = at
  }

  /** Whether the lock file still holds this holder's pid and timestamp: the lock this holder wrote, and not one written in its place. */
  private holdsLockFile(): boolean {
    const at = this.heldAt
    if (at === null) return false
    let now: NoFollowRead
    try {
      now = readNoFollow(this.path)
    } catch {
      return false
    }
    if (now.kind !== "file") return false
    try {
      const parsed = JSON.parse(now.text) as { pid?: unknown; at?: unknown }
      return parsed.pid === process.pid && parsed.at === at
    } catch {
      return false
    }
  }

  /**
   * Record the sequence number of the move or restore this holder is about to append. A holder that dies after the append leaves the
   * number in its lock, and recovery finishes that entry's source and no other. Called under the lock, before the append.
   */
  recordInFlight(seq: number): void {
    const at = this.heldAt
    if (this.depth === 0 || at === null) throw KnowledgeFailure.mutationRefused("the write lock is not held")
    // A lock another holder wrote in its place is contention, as a refused acquire is.
    if (!this.holdsLockFile()) throw KnowledgeFailure.mutationRefused("vault is locked by another writer")
    writeFileDurable(this.path, JSON.stringify({ pid: process.pid, at, seq }))
  }

  /**
   * Judge the lock an attempt found, and remove it when its holder is gone. `retry`: the lock vanished, so the create may now
   * succeed. `reclaimed`: a dead or stale holder's lock was removed here. `held`: a live holder, or a lock that is not a file of
   * its own, keeps it.
   */
  private reclaimIfStale(): "retry" | "reclaimed" | "held" {
    // The lock is read without following a link and without blocking on a pipe. A lock that is not a file of its own is held:
    // it is never read through and never reclaimed, so a pipe at the lock path refuses the write instead of blocking it.
    let lock: NoFollowRead
    try {
      lock = readNoFollow(this.path)
    } catch {
      return "held"
    }
    if (lock.kind === "absent") return "retry"
    if (lock.kind !== "file") return "held"
    const pid = lockPidOf(lock.text)
    if (pid !== null) {
      const liveness = pidLiveness(pid)
      // The recorded holder is still running. We never steal a live holder's lock: the operator has to wait, or kill the holder.
      if (liveness === "alive") return "held"
      // Dead pid: reclaim regardless of the mtime. A crashed writer is reclaimed as soon as we notice, instead of after LOCK_STALE_MS.
      if (liveness === "dead") return this.unlinkJudged(lock.text)
      // liveness === "unknown": the recorded pid is not something the kernel can check (negative, too large, non-integer). Fall back
      // to the time-only heuristic instead of guessing.
    }

    // No recorded pid (legacy file, corrupt file, or unverifiable). Fall back to the time-only heuristic.
    let age: number
    try {
      age = Date.now() - statSync(this.path).mtimeMs
    } catch {
      // The lock vanished between the failed create and here: retry.
      return "retry"
    }
    if (age < LOCK_STALE_MS) return "held"
    return this.unlinkJudged(lock.text)
  }

  /**
   * Remove the lock that was judged, and only that one. The judgement read the lock's text (its pid and the time it was taken).
   * Between that read and the unlink another writer can take the lock, and removing a live holder's lock is the failure this
   * prevents. So the lock is read again through the same no-follow reader, and removed only when its text is unchanged.
   */
  private unlinkJudged(judged: string): "retry" | "reclaimed" | "held" {
    this.hooks.afterJudgement?.()
    let now: NoFollowRead
    try {
      now = readNoFollow(this.path)
    } catch {
      return "held"
    }
    if (now.kind === "absent") return "retry"
    // A different lock now holds the path: it is not the one judged, so it is left in place.
    if (now.kind !== "file" || now.text !== judged) return "held"
    try {
      unlinkSync(this.path)
      this.reclaimedText = judged
      return "reclaimed"
    } catch {
      // Vanished between the re-read and here: retry.
      return "retry"
    }
  }
}

/** Test seams for the lock. `afterJudgement` runs between a holder's judgement and the re-read that precedes its removal. */
export interface WriteLockHooks {
  afterJudgement?: () => void
}

/**
 * Open flag that refuses a symbolic link at the final path component, where the platform has it. Windows has no such flag:
 * there a link is followed, and the containment checks of the caller are what keep the access inside the vault.
 */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

/**
 * Whether a symbolic link sits at `path`. Used only where the platform has no `O_NOFOLLOW` (Windows): there an open follows
 * a link, and an exclusive create at a dangling link creates its target, so the link is looked for first. A look before an
 * open is a narrower protection than the flag, because the path can change in between; ADR-092 records the residual.
 */
function isLinkNow(path: string): boolean {
  if (NO_FOLLOW !== 0) return false
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
/** So that opening a named pipe does not wait for a writer. Regular files are unaffected. */
const NO_BLOCK = constants.O_NONBLOCK ?? 0

/** Whether a locator names a file in the trash, the one place of the vault's own folder a restore reads from. */
function isTrashLocator(locator: string): boolean {
  const parts = normalize(locator).split(/[\\/]/).filter((part) => part !== "")
  return parts[0] === ".unifia" && parts[1] === "trash"
}

const WINDOWS_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

/** Whether a file name is one Windows reserves for a device, with or without an extension: `CON.md` is the console there. */
export function isWindowsDeviceName(name: string): boolean {
  return WINDOWS_DEVICE.test(name)
}

/**
 * What is at a path, read without following a link. A link is reported, and never read through. `other` is anything that
 * is not a regular file with one name: a pipe, a device, a folder, or a file another name also reaches.
 */
export type NoFollowRead = { kind: "absent" } | { kind: "link" } | { kind: "other" } | { kind: "file"; text: string }

/**
 * Read a file, refusing a link at its path. Where the platform has `O_NOFOLLOW` the open is the only look at the path, so
 * nothing can be swapped in between. On Windows `isLinkNow` looks first, and the gap between the look and the open is the
 * residual ADR-092 records. Recovery reads through this, and never reads a file a link points to.
 */
export function readNoFollow(path: string): NoFollowRead {
  if (isLinkNow(path)) return { kind: "link" }
  // On Windows a device name is not a file: opening it can wait on the device, so it is not opened.
  if (process.platform === "win32" && isWindowsDeviceName(basename(path))) return { kind: "other" }
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW | NO_BLOCK)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { kind: "absent" }
    if (code === "ELOOP") return { kind: "link" }
    // The operating system's message would carry the absolute path: the failure names none.
    throw KnowledgeFailure.mutationRefused("the file cannot be read")
  }
  try {
    const stats = fstatSync(fd)
    // Read only what is the vault's alone: a second name for the same bytes means the same content lives elsewhere too.
    if (!stats.isFile() || stats.nlink > 1) return { kind: "other" }
    return { kind: "file", text: readFileSync(fd, "utf8") }
  } finally {
    closeSync(fd)
  }
}

export interface RecoveryReport {
  /** Temporary files whose WAL entry says they were committed. */
  completed: string[]
  /** Temporary files with no committed entry: the write never happened. */
  discarded: string[]
  /**
   * Temporary files left in place, with their WAL entries: the destination holds something other than what the write replaced
   * (an edit made after the crash), or the note's later entries do not allow the write to land. Reported, never overwritten.
   */
  conflicts: string[]
  /** WAL lines that could not be parsed, usually a torn final append. */
  truncatedWalLines: number
}

/**
 * Whether a pending temporary may be completed over the destination as it is now. A create, a move or a restore needs the
 * destination absent. An update needs it to hold the bytes the write replaced. Any other content is an edit made after the
 * write was committed, and recovery does not write over it.
 */
function destinationAllowsCompletion(entry: WalEntry, current: NoFollowRead): boolean {
  const needsAbsent = entry.previousHash === null || entry.previousLocator !== undefined
  if (current.kind === "absent") return needsAbsent
  if (current.kind !== "file") return false
  return !needsAbsent && sha256(current.text) === entry.previousHash
}

/** What recovery does with one pending temporary. */
type TemporaryVerdict =
  /** Its bytes were never recorded for the note, or a newer write that is already visible replaced them: dropped. */
  | { kind: "discard" }
  /** The note's newest entry is the write these bytes belong to: completed, if the destination allows it. */
  | { kind: "write"; entry: WalEntry }
  /** The note's history ends in a delete or a move, or a newer write that is not visible: kept for the operator. */
  | { kind: "conflict" }

/**
 * Decide one temporary of the note `key` by the newest WAL entry that touches the note: a write at it, a delete of it, or a
 * move away from it. A temporary completes only when that newest entry is the write whose bytes it holds. A later delete or
 * move-away does not resurrect the bytes, and the temporary is kept rather than dropped, because it is the only copy of what
 * the log committed. A later write replaces the bytes only once its own bytes are visible at the note.
 */
function judgeTemporary(hash: string, key: string, entries: WalEntry[], current: NoFollowRead): TemporaryVerdict {
  const touching = entries.filter(
    (e) =>
      recoveryKey(e.locator) === key ||
      (typeof e.previousLocator === "string" && recoveryKey(e.previousLocator) === key),
  )
  const writesNote = (e: WalEntry): boolean => e.newHash !== null && recoveryKey(e.locator) === key
  const own = touching.filter((e) => writesNote(e) && e.newHash === hash).at(-1)
  // No durable record of this write: it never happened.
  if (own === undefined) return { kind: "discard" }
  const last = touching[touching.length - 1]
  if (last === own) return { kind: "write", entry: own }
  if (last !== undefined && writesNote(last) && current.kind === "file" && sha256(current.text) === last.newHash) {
    return { kind: "discard" }
  }
  return { kind: "conflict" }
}

/**
 * Reconcile the vault with its WAL after a crash.
 *
 * A temporary file is finished only when the newest WAL entry for its note is
 * the write whose bytes it holds, and the destination is in the state that
 * write replaced (see `judgeTemporary` and `destinationAllowsCompletion`). A
 * temporary of bytes never recorded for its note is discarded: an unrecorded
 * temporary is a write that never reached the log, and redoing it would invent
 * history. A temporary whose note has a later delete or move is kept, and
 * reported as a conflict, never completed.
 *
 * For `move` and `restore` entries the WAL carries `previousLocator`: the
 * path the note used to live at. If the destination already holds the
 * recorded hash but the source is still there, the write half-completed
 * before the unlink — we drop the source so the vault never carries two
 * silent copies of the same note.
 */
/** Whether the platform names files without case, so that `Notes` and `notes` are one folder. */
const FOLDS_CASE = process.platform === "win32" || process.platform === "darwin"

/**
 * The key a note is recovered by: its locator as the platform spells it, with case folded where the platform folds it. Exported,
 * so that the rule is tested on every platform.
 */
export function recoveryKey(locator: string, foldsCase: boolean = FOLDS_CASE): string {
  const normalized = normalize(locator)
  if (!foldsCase) return normalized
  // Windows ignores the trailing dots and spaces of a name, and does not keep the case of a name apart.
  return normalized.replace(/[. ]+(?=[\\/]|$)/g, "").toLowerCase()
}

export interface RecoverOptions {
  /**
   * The sequence number of the move or restore a dead writer had in flight, as its lock recorded it. Only that entry's source is
   * unlinked, and only when the destination holds the recorded bytes and the source still holds them too. Absent or null: no move
   * was in flight, so no source is unlinked, and identical bytes written back at an old path are kept.
   */
  inFlightSeq?: number | null
}

/** What recovery decides for one pending temporary. */
type TemporaryPlan =
  /** Its bytes are not the note's newest record, so the temporary is dropped. */
  | { kind: "discard"; tmp: string }
  /** The rename had already landed: the leftover is dropped and the note counts as completed. */
  | { kind: "landed"; tmp: string; destination: string }
  /** The rename can be finished over the destination as it is. */
  | { kind: "complete"; tmp: string; destination: string }
  /**
   * Left in place with its WAL entry: the destination holds something the write did not replace (an edit made after the crash), or
   * the note's later entries do not allow the write to land. Neither the temporary nor the WAL is touched.
   */
  | { kind: "conflict"; tmp: string; destination: string }

/**
 * Decide one pending temporary, reading only: nothing is written or removed. Null for a temporary that is not a file of its own,
 * or whose destination cannot be read; such a temporary is left alone.
 */
function judgeTemporaryFile(root: string, tmp: string, entries: WalEntry[]): TemporaryPlan | null {
  let content: string
  try {
    const read = readNoFollow(tmp)
    if (read.kind !== "file") return null
    content = read.text
  } catch {
    return null
  }
  const destination = tmp.slice(0, tmp.lastIndexOf(TMP_SUFFIX))
  // A link at the destination is left as it is, with its temporary beside it, for the operator to look at.
  let current: NoFollowRead
  try {
    current = readNoFollow(destination)
  } catch {
    return null
  }
  if (current.kind === "link") return { kind: "conflict", tmp, destination }

  const verdict = judgeTemporary(sha256(content), recoveryKey(relative(root, destination)), entries, current)
  if (verdict.kind === "discard") return { kind: "discard", tmp }
  if (verdict.kind === "conflict") return { kind: "conflict", tmp, destination }
  const already = current.kind === "file" ? sha256(current.text) : undefined
  if (already === verdict.entry.newHash) return { kind: "landed", tmp, destination }
  if (destinationAllowsCompletion(verdict.entry, current)) return { kind: "complete", tmp, destination }
  return { kind: "conflict", tmp, destination }
}

/** Carry out one decision. A failure leaves the temporary for the next attempt rather than losing recorded content. */
function applyTemporaryPlan(plan: TemporaryPlan, report: RecoveryReport): void {
  switch (plan.kind) {
    case "discard":
      try {
        unlinkSync(plan.tmp)
        report.discarded.push(plan.tmp)
      } catch {
        // Someone else cleaned it up.
      }
      return
    case "conflict":
      report.conflicts.push(plan.tmp)
      return
    case "landed":
    case "complete":
      try {
        if (plan.kind === "landed") {
          unlinkSync(plan.tmp)
        } else {
          renameDurable(plan.tmp, plan.destination)
          fsyncDirectory(dirname(plan.destination))
        }
        report.completed.push(plan.destination)
      } catch {
        // Leave it for the next attempt rather than losing recorded content.
      }
      return
  }
}

/** The WAL's entries that name a note. An entry without a string locator is not a commit of any note, and no step reads its locator. */
function readRecoverableEntries(root: string, walFile: string): { entries: WalEntry[]; truncated: number } {
  const parsed = readWalTolerant(join(root, walFile))
  return { entries: parsed.entries.filter((e) => typeof e.locator === "string"), truncated: parsed.truncated }
}

/**
 * The notes whose pending write recovery would leave in place as a conflict, as vault-relative locators. It reads the WAL and the
 * vault and changes neither, so the knowledge doctor can list them beside a vault that is in use.
 */
export function listPendingConflicts(root: string, walFile: string): string[] {
  const { entries } = readRecoverableEntries(root, walFile)
  const out: string[] = []
  for (const tmp of findTemporaries(root)) {
    const plan = judgeTemporaryFile(root, tmp, entries)
    if (plan?.kind === "conflict") out.push(relative(root, plan.destination).split(sep).join("/"))
  }
  return out.sort()
}

export function recover(root: string, walFile: string, options: RecoverOptions = {}): RecoveryReport {
  const report: RecoveryReport = { completed: [], discarded: [], conflicts: [], truncatedWalLines: 0 }

  const { entries, truncated } = readRecoverableEntries(root, walFile)
  report.truncatedWalLines = truncated
  for (const tmp of findTemporaries(root)) {
    const plan = judgeTemporaryFile(root, tmp, entries)
    if (plan !== null) applyTemporaryPlan(plan, report)
  }

  // The source of a move is unlinked by the writer under the write lock, so this pass has work only when a writer died between
  // the destination commit and that unlink. The dead writer's lock names the entry it was appending; no other entry is finished.
  const inFlightSeq = options.inFlightSeq
  if (inFlightSeq === undefined || inFlightSeq === null) return report

  // Second pass: a crash between the destination commit and the unlink of
  // the previous path leaves a duplicate. The WAL told us where the note
  // used to live, so we can finish the unlink deterministically.
  // The WAL is a file the vault can be handed, so its locators are judged as the writer judges its own: a path that
  // climbs out of the vault, or runs through a link, is never read or unlinked.
  const realRoot = realOrNull(root)
  const containedHere = (path: string): boolean => realRoot !== null && wouldBeContained(realRoot, path)
  for (const entry of entries) {
    if (entry.seq !== inFlightSeq) continue
    // A previous locator that is not a string is not a path: the entry is passed over rather than read as one.
    if (typeof entry.previousLocator !== "string") continue
    if (entry.newHash === null) continue
    if (entry.kind !== "move" && entry.kind !== "restore") continue

    // A move or restore lands among the vault's notes, and may come from the trash. A WAL that names any other part of the
    // vault's own folder is not acted on.
    if (isInternalLocator(entry.locator)) continue
    if (isInternalLocator(entry.previousLocator) && !isTrashLocator(entry.previousLocator)) continue
    const destination = join(root, entry.locator)
    const source = join(root, entry.previousLocator)
    if (!containedHere(destination) || !containedHere(source)) continue
    try {
      // Each file is read without following a link, in the open itself: there is no look at the path before the read.
      const destinationNow = readNoFollow(destination)
      if (destinationNow.kind !== "file" || sha256(destinationNow.text) !== entry.newHash) {
        // The destination is not what the WAL recorded; the write never
        // landed or has been overwritten. Leave the source alone.
        continue
      }
      const sourceNow = readNoFollow(source)
      if (sourceNow.kind !== "file") {
        // The unlink had already happened, or the source is a link: nothing to do.
        continue
      }
      const sourceHash = sha256(sourceNow.text)
      if (sourceHash !== entry.newHash) {
        // The source is a different note now (or has been edited). The
        // recorder's note is at the destination; do not touch the source.
        continue
      }
      unlinkSync(source)
    } catch {
      // Leave it for the next attempt; we do not invent unlinks.
    }
  }

  return report
}

/**
 * Read a WAL, tolerating a torn final line.
 *
 * An append interrupted by a power loss leaves a partial JSON line. Refusing
 * to read the whole log because of it would lose every prior entry, so the
 * unparseable tail is counted and skipped.
 */
export function readWalTolerant(path: string): { entries: WalEntry[]; truncated: number } {
  const read = readNoFollow(path)
  if (read.kind === "absent") return { entries: [], truncated: 0 }
  // A log that is a link, or has a second name, is not read as empty: that would reset the sequence and hide the entries the
  // writer committed. It is refused, and the refusal names no path.
  if (read.kind !== "file") throw KnowledgeFailure.mutationRefused("the write-ahead log is not read: it is not a file of its own")
  const lines = read.text.split("\n").filter((l) => l.trim().length > 0)
  const entries: WalEntry[] = []
  let truncated = 0
  for (const line of lines) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      truncated += 1
      continue
    }
    // Only an object is an entry. A line that parses to anything else (`null`, a number, an array) is set aside like a torn one,
    // so that no later step reads a field of it.
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      truncated += 1
      continue
    }
    // An object without a whole sequence number is not an entry either: the next write would take its number, and the
    // sequence would break (NaN is written as null).
    if (!Number.isInteger((value as { seq?: unknown }).seq)) {
      truncated += 1
      continue
    }
    entries.push(value as WalEntry)
  }
  return { entries, truncated }
}

/** Every `*.unifia-tmp` under `root`, skipping the control directory. */
function findTemporaries(root: string, out: string[] = [], dir = root): string[] {
  // The type comes with the listing, so no entry is stat'ed: a link is seen as a link and never followed.
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue
    // The vault's own folder, at the root only, holds no commit's temporary: a temporary planted there is never recovered over
    // a file in it. A folder of that name deeper in the vault is an ordinary folder, and its temporaries are recovered.
    if (dir === root && entry.name === ".unifia") continue
    // A link is neither followed nor removed: it may lead outside the vault. A temporary link stays where it is, and
    // the write that wants its name is refused (writeNewFileDurable).
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) findTemporaries(root, out, full)
    else if (entry.name.endsWith(TMP_SUFFIX)) out.push(full)
  }
  return out
}

/**
 * Whether reconciling the vault can change anything: a WAL, a lock a writer left behind, or a temporary. A vault with none of
 * them is opened without taking the write lock, so opening it creates nothing. A link at either path counts, so that the
 * refusal of a link in the WAL is still reached.
 */
export function hasRecoveryWork(root: string, walFile: string, lockFile: string): boolean {
  const present = (path: string): boolean => {
    try {
      lstatSync(path)
      return true
    } catch {
      return false
    }
  }
  return present(join(root, walFile)) || present(join(root, lockFile)) || findTemporaries(root).length > 0
}

/** Remove a directory tree, used by tests and by the operator's own tooling. */
export function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true })
}
