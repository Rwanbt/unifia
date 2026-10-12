/* SPDX-License-Identifier: MIT */
/**
 * The platform calls the write lock depends on, behind one interface.
 *
 * The lock needs four things the operating systems do not agree on: an exclusive create that never follows a link, a rename that
 * may replace a file, a removal that may be refused while another process holds the file, and a way to tell a live process from
 * a dead one that reuses its number. POSIX gives the first two directly and the last two from `/proc` on Linux. Windows refuses
 * a rename or a removal while a handle is open on the file, and gives no process start time or boot identifier through Node.
 *
 * The POSIX adapter is tested on this machine. The Windows adapter is written from the documented semantics and is not run here.
 */

import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { KnowledgeFailure } from "../domain/errors.js"

/** Outcome of an exclusive create: `exists` when anything is at the path, a link included, and nothing was written. */
export type CreateOutcome = "created" | "exists"

export interface LockPlatform {
  readonly name: "posix" | "win32"
  /** Create `path` with `content`, exclusively, and flush it. Nothing is written over an existing entry, and a link is never followed. */
  createExclusive(path: string, content: string): CreateOutcome
  /** Replace `path` with `content` in one step: the bytes are flushed under a unique name beside it, then renamed over `path`. */
  replaceAtomic(path: string, content: string): void
  /** Remove the file at `path`. Returns false when nothing is there. */
  removeFile(path: string): boolean
  /** The start time of process `pid`, which changes when its number is reused; null where the platform does not give one. */
  startTimeOf(pid: number): string | null
  /** An identifier of the current boot; null where the platform does not give one. */
  bootId(): string | null
  /** The host name the lock records. */
  hostName(): string
}

/** Errors a Windows rename or removal raises while another handle is open on the file. */
const TRANSIENT_CODES = new Set(["EPERM", "EACCES", "EBUSY"])

/** How long a transient refusal is retried before it is reported. Bounded: a file held open indefinitely is a real failure. */
const RETRY_BUDGET_MS = 2_000
const RETRY_POLL_MS = 5

/** Block the thread for `ms`. The write path is synchronous by contract. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Run `attempt` until it stops failing with a transient refusal, or the budget runs out; the last error is then thrown. */
export function retryTransient<T>(attempt: () => T): T {
  const deadline = Date.now() + RETRY_BUDGET_MS
  for (;;) {
    try {
      return attempt()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ""
      if (!TRANSIENT_CODES.has(code) || Date.now() >= deadline) throw e
      sleepSync(RETRY_POLL_MS)
    }
  }
}

/**
 * Rename `from` over `to`. POSIX replaces the destination whatever holds it; Windows refuses while a handle is open on `to`, so the
 * rename is retried for a bounded time. The refusal names neither path: the operating system's message would carry both.
 */
export function renameOver(from: string, to: string): void {
  try {
    retryTransient(() => renameSync(from, to))
  } catch {
    throw KnowledgeFailure.mutationRefused("the write lock could not be replaced")
  }
}

/** Remove `path` with the same bounded retry as a rename; false when nothing is there. */
export function removeWithRetry(path: string): boolean {
  try {
    retryTransient(() => unlinkSync(path))
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false
    throw KnowledgeFailure.mutationRefused("the write lock could not be removed")
  }
}

/** Flush a directory entry, so that a create or a rename survives a power loss. Where the platform cannot open a directory, it is skipped. */
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

/** A temporary name beside `path` that no reader or recovery treats as a commit's temporary. */
export function siblingTemporary(path: string, token: string): string {
  return `${path}.${token}.lock-tmp`
}

/** Remove `path` if it is there, ignoring the failure: used only for a file this process created and is abandoning. */
export function removeQuietly(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Already gone.
  }
}

/**
 * The exclusive create both adapters share. `isContention` names the error codes that mean "something is already there" on this
 * platform; any other failure is a refusal that names no path. A file this call created is removed if it cannot be written, so
 * no partial record is left behind by a failure the process survived.
 */
export function createFlushedExclusive(path: string, content: string, isContention: (code: string) => boolean): CreateOutcome {
  let fd: number
  try {
    fd = openSync(path, "wx")
  } catch (e) {
    if (isContention((e as NodeJS.ErrnoException).code ?? "")) return "exists"
    throw KnowledgeFailure.mutationRefused("the write lock cannot be created")
  }
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } catch {
    closeQuietly(fd)
    removeQuietly(path)
    throw KnowledgeFailure.mutationRefused("the write lock cannot be written")
  }
  closeQuietly(fd)
  fsyncDirectory(dirname(path))
  return "created"
}

/** Replace `path` with `content`: the bytes are flushed under a unique name beside it, then renamed over `path`. */
export function replaceFlushed(path: string, content: string): void {
  const tmp = siblingTemporary(path, randomUUID())
  try {
    writeFlushedNew(tmp, content)
    renameOver(tmp, path)
  } catch (e) {
    removeQuietly(tmp)
    throw e
  }
  fsyncDirectory(dirname(path))
}

function writeFlushedNew(path: string, content: string): void {
  let fd: number
  try {
    fd = openSync(path, "wx")
  } catch {
    throw KnowledgeFailure.mutationRefused("the write lock cannot be replaced")
  }
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } catch {
    throw KnowledgeFailure.mutationRefused("the write lock cannot be replaced")
  } finally {
    closeQuietly(fd)
  }
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    // Already closed.
  }
}
