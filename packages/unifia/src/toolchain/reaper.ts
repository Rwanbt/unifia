// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { readdir, readFile } from "node:fs/promises"
import { startOf } from "./proc"

// Only processes that carry this variable are ever considered. Unifia writes it into the environment of
// the children it starts, so a process without it belongs to something else and is never touched.
const MARKER = "UNIFIA_OWNER"
const GRACE_MS = 1000

// The marker in a process's environment, if it has one.
async function markerOf(pid: number) {
  const raw = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => undefined)
  const entry = raw?.split("\0").find((item) => item.startsWith(`${MARKER}=`))
  return entry?.slice(MARKER.length + 1)
}

// A marker is "pid:start". It is orphaned when that owner no longer runs with the recorded start time,
// which covers both a finished owner and a pid that another process has since taken. A malformed
// marker is never orphaned: the reaper does not act on what it cannot read.
async function orphaned(marker: string) {
  const [pid, start] = marker.split(":").map(Number)
  if (!Number.isInteger(pid) || !Number.isInteger(start) || marker.split(":").length !== 2) return false
  return (await startOf(pid!)) !== start
}

function signal(pid: number, sig: "SIGTERM" | "SIGKILL") {
  try {
    process.kill(pid, sig)
  } catch {
    // The process already exited, which is the outcome we wanted.
  }
}

// Stops a process only while it is still the one that was found: the same pid with the same start time.
// It asks first with SIGTERM and gives the process a moment to exit before it sends SIGKILL.
async function terminate(target: { pid: number; start: number }) {
  if ((await startOf(target.pid)) !== target.start) return false
  signal(target.pid, "SIGTERM")
  await Bun.sleep(GRACE_MS)
  if ((await startOf(target.pid)) === target.start) signal(target.pid, "SIGKILL")
  return true
}

// Finds processes started under an owner that is gone, and stops them. Returns the pids it stopped.
export async function reap(): Promise<number[]> {
  const pids = (await readdir("/proc"))
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .filter((pid) => pid !== process.pid)
  const found = await Promise.all(
    pids.map(async (pid) => {
      const marker = await markerOf(pid)
      if (marker === undefined || !(await orphaned(marker))) return undefined
      const start = await startOf(pid)
      return start === undefined ? undefined : { pid, start }
    }),
  )
  const killed: number[] = []
  for (const target of found.filter((item) => item !== undefined)) {
    if (await terminate(target)) killed.push(target.pid)
  }
  return killed
}
