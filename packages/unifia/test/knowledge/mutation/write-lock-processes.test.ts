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

const createIntent = (locator: string, body: string) => ({
  kind: "create",
  targetLocator: locator,
  newContent: {
    type: "decision",
    restrictions: { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" },
    body,
  },
  reason: "processes",
  source: "test",
})

/** The owner the lock file names right now, or null when it names none. */
function lockOwner(root: string): string | null {
  const path = join(root, LOCK_FILE)
  if (!existsSync(path)) return null
  return (JSON.parse(readFileSync(path, "utf8")) as { owner?: string }).owner ?? null
}

/**
 * `count` writers race for the lock over `rounds` rounds. Each round starts with a dead holder's lock in place, so every writer
 * reclaims it at once. Returns each writer's outcome per round.
 */
async function raceWriters(
  root: string,
  dir: string,
  count: number,
  rounds: number,
): Promise<Record<string, string[]>> {
  const ids = Array.from({ length: count }, (_, i) => `w${i}`)
  const children = ids.map((id) => spawnChild(dir, root, id, { mode: "race", rounds }))
  const outcomes: Record<string, string[]> = {}
  for (let round = 0; round < rounds; round += 1) {
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
    writeFileSync(join(dir, `go-${round}`), "")
    for (const child of children) {
      await waitForFile(join(dir, `out-${round}-${child.id}`))
      outcomes[child.id] = [...(outcomes[child.id] ?? []), readFileSync(join(dir, `out-${round}-${child.id}`), "utf8")]
    }
  }
  for (const child of children) await child.proc.exited
  return outcomes
}

describe("write lock across processes", () => {
  let root: string
  let dir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-lockproc-"))
    dir = mkdtempSync(join(tmpdir(), "unifia-lockproc-dir-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
    mkdirSync(join(root, "notes"), { recursive: true })
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
    const outcomes = await raceWriters(root, dir, 2, rounds)
    expect(violationsIn(dir)).toEqual([])
    expectVaultMatches(root, outcomes, rounds)
  }, 120_000)

  it("three writers racing for a dead holder's lock, over many rounds, never overlap", async () => {
    const rounds = 100
    const outcomes = await raceWriters(root, dir, 3, rounds)
    expect(violationsIn(dir)).toEqual([])
    expectVaultMatches(root, outcomes, rounds)
  }, 120_000)

  it("a writer whose lock is reclaimed mid-write is fenced out, and the newer write stands", async () => {
    const lockPath = join(root, LOCK_FILE)
    const stale = spawnChild(dir, root, "w", {
      mode: "write",
      intent: createIntent("notes/w.md", "stale"),
      pauseAt: "temporary-durable",
    })
    await waitForFile(join(dir, "at-temporary-durable-w"))

    // The stale writer's lock is reclaimed: its file goes. A newer writer takes the free lock and commits.
    rmSync(lockPath)
    const newer = spawnChild(dir, root, "n", { mode: "write", intent: createIntent("notes/n.md", "newer") })
    await newer.proc.exited
    expect(readFileSync(join(dir, "out-n"), "utf8")).toBe("applied")

    // The stale writer resumes: it is refused before its log line, and nothing of it is left.
    writeFileSync(join(dir, "go-temporary-durable-w"), "")
    await stale.proc.exited
    expect(readFileSync(join(dir, "out-w"), "utf8")).toMatch(/taken by another writer/)
    expect(existsSync(join(root, "notes", "w.md"))).toBe(false)
    expect(existsSync(join(root, "notes", "n.md"))).toBe(true)
    expect(readdirSync(join(root, "notes")).filter((name) => name.endsWith(".unifia-tmp"))).toEqual([])
    expect(readFileSync(join(root, WAL_FILE), "utf8").trim().split("\n")).toHaveLength(1)
  })

  it("a reclaim racing a live holder is refused, and the live holder's lock stays", async () => {
    const holder = spawnChild(dir, root, "h", { mode: "lock", pauseInside: true })
    await waitForFile(join(dir, "at-inside-h"))
    const owner = lockOwner(root)
    expect(owner).not.toBeNull()

    // A second writer tries to take the lock while the holder is alive: it is refused and removes nothing.
    const contender = spawnChild(dir, root, "r", { mode: "lock" })
    await contender.proc.exited
    expect(readFileSync(join(dir, "out-r"), "utf8")).toMatch(/locked by another writer/)
    expect(lockOwner(root)).toBe(owner)

    writeFileSync(join(dir, "go-inside-h"), "")
    await holder.proc.exited
    expect(readFileSync(join(dir, "release-h"), "utf8")).toBe("released")
    expect(lockOwner(root)).toBeNull()
    expect(violationsIn(dir)).toEqual([])
  })

  it("a former holder that releases after its lock was taken over leaves the new holder's lock, and reports foreign", async () => {
    const former = spawnChild(dir, root, "a", { mode: "lock", pauseInside: true })
    await waitForFile(join(dir, "at-inside-a"))

    // The former holder's lock is taken over: its file goes, and another writer takes the lock. (The former holder is still inside its
    // section, so the section overlap this creates is the test's own doing, and the violation list is not checked here.)
    rmSync(join(root, LOCK_FILE))
    const successor = spawnChild(dir, root, "b", { mode: "lock", pauseInside: true })
    await waitForFile(join(dir, "at-inside-b"))
    const successorOwner = lockOwner(root)
    expect(successorOwner).not.toBeNull()

    // The former holder leaves its section and releases: the successor's lock is not its own, so it is left alone.
    writeFileSync(join(dir, "go-inside-a"), "")
    await former.proc.exited
    expect(readFileSync(join(dir, "release-a"), "utf8")).toBe("foreign")
    expect(lockOwner(root)).toBe(successorOwner)

    writeFileSync(join(dir, "go-inside-b"), "")
    await successor.proc.exited
    expect(readFileSync(join(dir, "release-b"), "utf8")).toBe("released")
  })
})

/** Every writer's report matches the vault: a note exists exactly when its writer reported it applied, and the lock is gone. */
function expectVaultMatches(root: string, outcomes: Record<string, string[]>, rounds: number): void {
  const notesOnDisk = new Set(readdirSync(join(root, "notes")).filter((name) => name.endsWith(".md")))
  const expected = new Set<string>()
  for (let round = 0; round < rounds; round += 1) {
    for (const [id, list] of Object.entries(outcomes)) {
      if (list[round] === "applied") expected.add(`r${round}-${id}.md`)
    }
  }
  const mismatch = {
    reportedButMissing: [...expected].filter((name) => !notesOnDisk.has(name)),
    onDiskButUnreported: [...notesOnDisk].filter((name) => !expected.has(name)),
  }
  expect(mismatch).toEqual({ reportedButMissing: [], onDiskButUnreported: [] })
  expect(existsSync(join(root, LOCK_FILE))).toBe(false)
}
