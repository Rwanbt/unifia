/* SPDX-License-Identifier: MIT */
/**
 * The Windows adapter of the write lock's platform calls.
 *
 * NOT RUN in the environment this was written in. It follows the documented semantics of the calls it makes and has no test result
 * behind it; the POSIX adapter is the one tested.
 *
 * - Exclusive create: `CREATE_NEW` refuses an existing file. Windows follows a symbolic link in an open, and an exclusive create at
 *   a dangling link creates the link's target outside the vault, so a link at the path is refused before the create. The create
 *   reports `EPERM` for a file that is pending deletion; that is contention, as `EEXIST` is.
 * - Replace and remove: `MoveFileEx` (behind `rename`) and `DeleteFile` (behind `unlink`) fail while another process holds a handle
 *   on the file without delete sharing. They are retried for a bounded time, then reported as a refusal.
 * - Process identity: Node does not expose a process start time or a boot identifier on Windows, so both are null. A lock that
 *   records a pid and no start time is held while that pid exists, so a reused pid blocks the vault until the process using it
 *   exits. That is the availability cost of integrity-first on this platform.
 */

import { lstatSync } from "node:fs"
import { hostname } from "node:os"
import { type LockPlatform, createFlushedExclusive, removeWithRetry, replaceFlushed } from "./lock-platform.js"

/** Whether a symbolic link sits at `path`. Looked for before the exclusive create, because the create would follow it. */
function isSymlinkNow(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

export const win32Platform: LockPlatform = {
  name: "win32",
  createExclusive(path, content) {
    if (isSymlinkNow(path)) return "exists"
    return createFlushedExclusive(path, content, (code) => code === "EEXIST" || code === "EPERM")
  },
  replaceAtomic: (path, content) => replaceFlushed(path, content),
  removeFile: (path) => removeWithRetry(path),
  startTimeOf: () => null,
  bootId: () => null,
  hostName: () => hostname(),
}
