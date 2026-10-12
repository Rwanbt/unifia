/* SPDX-License-Identifier: MIT */
/**
 * The POSIX adapter of the write lock's platform calls. Tested on Linux.
 *
 * - Exclusive create: `O_CREAT | O_EXCL` never follows a link, dangling or not, so the create alone refuses one.
 * - Replace and remove: `rename` and `unlink` act on the directory entry whatever holds the file open.
 * - Process identity: the start time is field 22 of `/proc/<pid>/stat`, and the boot id is `/proc/sys/kernel/random/boot_id`. Both
 *   exist on Linux only; elsewhere they are null, and a lock that records no start time is never judged dead while its pid lives.
 */

import { readFileSync } from "node:fs"
import { hostname } from "node:os"
import { type LockPlatform, createFlushedExclusive, removeWithRetry, replaceFlushed } from "./lock-platform.js"

const PROC = "/proc"

/** `/proc/<pid>/stat`: the start time in clock ticks since boot, field 22. The command name may hold spaces, so fields are read after its closing parenthesis. */
export function linuxStartTime(pid: number): string | null {
  try {
    const text = readFileSync(`${PROC}/${pid}/stat`, "utf8")
    const field = text.slice(text.lastIndexOf(")") + 2).split(" ")[19]
    return field !== undefined && /^\d+$/.test(field) ? field : null
  } catch {
    return null
  }
}

/** The kernel's boot identifier, which changes on every boot. */
export function linuxBootId(): string | null {
  try {
    const id = readFileSync(`${PROC}/sys/kernel/random/boot_id`, "utf8").trim()
    return id.length > 0 ? id : null
  } catch {
    return null
  }
}

export const posixPlatform: LockPlatform = {
  name: "posix",
  createExclusive: (path, content) => createFlushedExclusive(path, content, (code) => code === "EEXIST"),
  replaceAtomic: (path, content) => replaceFlushed(path, content),
  removeFile: (path) => removeWithRetry(path),
  startTimeOf: linuxStartTime,
  bootId: linuxBootId,
  hostName: () => hostname(),
}
