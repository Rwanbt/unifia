/* SPDX-License-Identifier: MIT */
/**
 * Write-lock protocol, across processes: mutual exclusion is shown with real writers racing for the lock, not assumed from the
 * code. Each writer marks its critical section; a process that finds another marker inside it records a violation.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LOCK_FILE, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"

const CHILD = join(import.meta.dir, "write-lock-child.ts")
/** Larger than any pid the kernel allocates on this platform: the holder it names is dead. */
const DEAD_PID = 0x7ffffffe

interface Child {
  id: string
  proc: ReturnType<typeof Bun.spawn>
}

function spawnChild(dir: string, root: string, id: string, extra: Record<string, unknown>): Child {
  const specPath = join(dir, `spec-${id}.json`)
  writeFileSync(specPath, JSON.stringify({ root, dir, id, ...extra }))
  const proc = Bun.spawn([process.execPath, CHILD, specPath], { stdout: "pipe", stderr: "pipe" })
  return { id, proc }
}

async function waitForFile(path: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`)
    await Bun.sleep(2)
  }
}

function violationsIn(dir: string): string[] {
  const path = join(dir, "violations")
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0) : []
}

describe("write lock across processes", () => {
  let root: string
  let dir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-lockproc-"))
    dir = mkdtempSync(join(tmpdir(), "unifia-lockproc-dir-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it("L10: a second writer does not enter while a reclaim sits between its re-read and its unlink", async () => {
    const lockPath = join(root, LOCK_FILE)
    // A dead holder's lock: both writers must reclaim it to proceed.
    writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))

    // A reclaims and stops after its re-read, before the unlink.
    const a = spawnChild(dir, root, "a", { mode: "lock", pauseAfterReread: true })
    await waitForFile(join(dir, "at-reread-a"))

    // B then tries the same reclaim, and holds the lock inside its section if it gets it. Either it is refused, or it pauses there.
    const b = spawnChild(dir, root, "b", { mode: "lock", pauseInside: true })
    await Promise.race([waitForFile(join(dir, "at-inside-b")), waitForFile(join(dir, "out-b"))])

    // A goes on: its unlink and its create must not take a live lock away from B, and A must not enter while B is inside.
    writeFileSync(join(dir, "go-reread-a"), "")
    await waitForFile(join(dir, "done-a"))
    writeFileSync(join(dir, "go-inside-b"), "")
    await a.proc.exited
    await b.proc.exited

    expect(violationsIn(dir)).toEqual([])
  })

  it("two writers racing for a dead holder's lock, over many rounds, never overlap", async () => {
    const rounds = 150
    const children = ["p", "q"].map((id) => spawnChild(dir, root, id, { mode: "race", rounds }))
    const outcomes: Record<string, string[]> = {}

    for (let round = 0; round < rounds; round += 1) {
      // A dead holder's lock is in place when the round starts; both writers then reclaim it at once.
      writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
      writeFileSync(join(dir, `go-${round}`), "")
      for (const child of children) {
        await waitForFile(join(dir, `out-${round}-${child.id}`))
        outcomes[child.id] = [...(outcomes[child.id] ?? []), readFileSync(join(dir, `out-${round}-${child.id}`), "utf8")]
      }
    }
    for (const child of children) await child.proc.exited

    expect(violationsIn(dir)).toEqual([])
    // Every writer's report matches the vault: a note exists exactly when its writer reported it applied.
    const notesOnDisk = new Set(readdirSync(join(root, "notes")).filter((name) => name.endsWith(".md")))
    const expected = new Set<string>()
    for (let round = 0; round < rounds; round += 1) {
      for (const child of children) {
        if (outcomes[child.id]?.[round] === "applied") expected.add(`r${round}-${child.id}.md`)
      }
    }
    const mismatch = {
      reportedButMissing: [...expected].filter((name) => !notesOnDisk.has(name)),
      onDiskButUnreported: [...notesOnDisk].filter((name) => !expected.has(name)),
      refusals: Object.fromEntries(
        Object.entries(outcomes).map(([id, list]) => [id, list.filter((o) => o !== "applied")]),
      ),
    }
    expect(mismatch).toEqual({ reportedButMissing: [], onDiskButUnreported: [], refusals: expect.any(Object) })
    expect(existsSync(join(root, WAL_FILE))).toBe(expected.size > 0)
  }, 120_000)
})
