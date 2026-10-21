// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { readFile } from "node:fs/promises"

// Start time of a process from /proc/<pid>/stat (field 22, clock ticks since boot). Recorded next to a
// pid, it tells the process that was recorded from one that later reused the same pid.
export async function startOf(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined)
  if (stat === undefined) return undefined
  return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19])
}

// Signal 0 only probes: it throws when the pid does not exist.
export function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// The identity of this process, to be written into the environment of every child it starts.
export async function ownerMarker() {
  return `${process.pid}:${await startOf(process.pid)}`
}
