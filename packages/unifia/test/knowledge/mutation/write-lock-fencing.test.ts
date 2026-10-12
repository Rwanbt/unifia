/* SPDX-License-Identifier: MIT */
/**
 * Fencing: a writer whose lock was taken over is refused before each step that changes the vault, a stale writer cannot commit
 * over a newer one, and the log's epoch floor refuses a commit made under a lower epoch.
 *
 * Each take-over is made from a commit-step hook, so it lands between two steps of one real commit, in one process: the step the
 * hook names has finished, and the next step is the one the fence must stop.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { VaultMutationWriter, LOCK_FILE, WAL_FILE, type CommitStep } from "../../../src/knowledge/mutation/writer.js"
import { WriteLock, appendLineDurable } from "../../../src/knowledge/mutation/durability.js"
import { MAX_PID } from "../../../src/knowledge/mutation/lock-record.js"
import type { WalEntry } from "../../../src/knowledge/wal/wal.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const

function freshVault(): string {
  const root = mkdtempSync(join(tmpdir(), "unifia-fencing-"))
  mkdirSync(join(root, ".unifia"), { recursive: true })
  mkdirSync(join(root, "notes"), { recursive: true })
  return root
}

const createIntent = (locator: string, body = "body") => ({
  intent: {
    kind: "create",
    targetLocator: locator,
    newContent: { type: "decision", restrictions: OPEN, body },
    reason: "fencing",
    source: "test",
  },
  reason: "fencing",
  source: "test",
})

/** The lock is taken over: its file names another holder, which is gone (a dead pid on this host). */
function takeOver(root: string): void {
  writeFileSync(
    join(root, LOCK_FILE),
    JSON.stringify({
      v: 2,
      owner: randomUUID(),
      pid: MAX_PID,
      start: null,
      boot: null,
      host: hostname(),
      epoch: 99,
      at: new Date().toISOString(),
    }),
  )
}

function walEntries(root: string): WalEntry[] {
  const path = join(root, WAL_FILE)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as WalEntry)
}

function tmpFilesIn(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === ".unifia") continue
      const full = join(dir, name.name)
      if (name.isDirectory()) walk(full)
      else if (name.name.endsWith(".unifia-tmp")) out.push(full)
    }
  }
  walk(root)
  return out
}

/** A writer whose hook takes the lock over once, at `step`, and reports what it did. */
function takingOverAt(root: string, step: CommitStep) {
  let taken = false
  return new VaultMutationWriter({
    root,
    hooks: {
      atStep: (reached) => {
        if (reached === step && !taken) {
          taken = true
          takeOver(root)
        }
      },
    },
  })
}

describe("fencing: a writer whose lock was taken over is refused before it writes", () => {
  let root: string
  beforeEach(() => {
    root = freshVault()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("before the temporary is written, nothing is written", async () => {
    const writer = takingOverAt(root, "lock-durable")
    await expect(writer.apply(createIntent("notes/a.md"))).rejects.toThrow(/taken by another writer/)
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
    expect(tmpFilesIn(root)).toEqual([])
    expect(walEntries(root)).toEqual([])
  })

  it("between the temporary and the log line, the temporary is removed and nothing is logged", async () => {
    const writer = takingOverAt(root, "temporary-durable")
    await expect(writer.apply(createIntent("notes/a.md"))).rejects.toThrow(/taken by another writer/)
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
    expect(tmpFilesIn(root)).toEqual([])
    expect(walEntries(root)).toEqual([])
  })

  it("after the log line and before the rename, the log names the write and the next open completes it", async () => {
    const writer = takingOverAt(root, "wal-durable")
    await expect(writer.apply(createIntent("notes/a.md", "logged"))).rejects.toThrow(/taken by another writer/)
    // The write is in the log, so it is not dropped; it is not visible until the next lock holder completes it.
    expect(walEntries(root)).toHaveLength(1)
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
    expect(tmpFilesIn(root)).toHaveLength(1)

    // The take-over holder is gone (its pid is dead), so the next open reclaims the lock and completes the logged write.
    new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "notes", "a.md"), "utf8")).toContain("logged")
    expect(tmpFilesIn(root)).toEqual([])
  })

  it("a delete is refused before it moves anything, when the lock was taken over at its first step", async () => {
    // A note to delete, written by a writer with no hooks; its reference carries the id and the version hash the delete needs.
    const seeded = await new VaultMutationWriter({ root }).apply(createIntent("notes/d.md", "to delete"))
    const id = seeded.ref?.id
    const hash = seeded.ref?.versionHash
    expect(walEntries(root)[0]?.kind).toBe("create")
    expect(id).toBeDefined()
    expect(hash).toBeDefined()

    let taken = false
    const writer = new VaultMutationWriter({
      root,
      hooks: {
        atStep: (step) => {
          if (step === "lock-durable" && !taken) {
            taken = true
            takeOver(root)
          }
        },
      },
    })
    await expect(
      writer.apply({
        intent: { kind: "delete", targetId: id, expectedVersionHash: hash, reason: "fencing", source: "test" },
        reason: "fencing",
        source: "test",
      }),
    ).rejects.toThrow(/taken by another writer/)
    expect(existsSync(join(root, "notes", "d.md"))).toBe(true)
    expect(existsSync(join(root, ".unifia", "trash"))).toBe(false)
    expect(walEntries(root)).toHaveLength(1)
  })

  it("the lock file another holder wrote is left in place by the refused writer's release", async () => {
    const writer = takingOverAt(root, "temporary-durable")
    await expect(writer.apply(createIntent("notes/a.md"))).rejects.toThrow(/taken by another writer/)
    const takenText = readFileSync(join(root, LOCK_FILE), "utf8")
    expect(JSON.parse(takenText).epoch).toBe(99)
  })
})

describe("fencing: a stale writer cannot commit over a newer one", () => {
  let root: string
  beforeEach(() => {
    root = freshVault()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("a writer whose lock was reclaimed mid-write is refused, and the newer write stands", async () => {
    // A seed note whose bytes are a valid note, to be written by the newer writer.
    await new VaultMutationWriter({ root }).apply(createIntent("notes/seed.md", "newer"))
    const seedRaw = readFileSync(join(root, "notes", "seed.md"), "utf8")

    const stale = new VaultMutationWriter({
      root,
      hooks: {
        atStep: (step) => {
          if (step !== "temporary-durable") return
          // The stale writer's lock is reclaimed: its file goes. The newer writer takes the free lock and commits the same note.
          rmSync(join(root, LOCK_FILE))
          const newer = new VaultMutationWriter({ root })
          newer.commitNewNote("notes/a.md", seedRaw, "newer", "the newer writer")
        },
      },
    })
    await expect(stale.apply(createIntent("notes/a.md", "stale"))).rejects.toThrow(/taken by another writer/)
    expect(readFileSync(join(root, "notes", "a.md"), "utf8")).toBe(seedRaw)
    expect(tmpFilesIn(root)).toEqual([])
    // Only the seed and the newer writer's commit are in the log: the stale write is not.
    expect(walEntries(root).map((e) => e.locator)).toEqual(["notes/seed.md", "notes/a.md"])
  })

  it("the log's epoch floor refuses a commit made under a lower epoch, though the holder still owns its lock", async () => {
    let injected = false
    const writer = new VaultMutationWriter({
      root,
      hooks: {
        atStep: (step) => {
          if (step !== "temporary-durable" || injected) return
          injected = true
          // A newer grant committed at epoch 99 while this writer holds the lock at its own, lower epoch.
          appendLineDurable(
            join(root, WAL_FILE),
            JSON.stringify({
              seq: 1,
              epoch: 99,
              kind: "create",
              locator: "elsewhere.md",
              previousHash: null,
              newHash: "a".repeat(64),
              auditId: "newer",
              source: "test",
              reason: "newer",
              timestamp: new Date().toISOString(),
            }),
          )
        },
      },
    })
    await expect(writer.apply(createIntent("notes/a.md"))).rejects.toThrow(/newer write has been committed/)
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
    expect(tmpFilesIn(root)).toEqual([])
    expect(walEntries(root).map((e) => e.epoch)).toEqual([99])
  })
})

describe("fencing: epochs and the lock object", () => {
  let root: string
  beforeEach(() => {
    root = freshVault()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("the epochs of successive committed writes strictly increase, and each entry records its epoch", async () => {
    const writer = new VaultMutationWriter({ root })
    for (const locator of ["notes/one.md", "notes/two.md", "notes/three.md"]) {
      await writer.apply(createIntent(locator))
    }
    const epochs = walEntries(root).map((e) => e.epoch)
    expect(epochs).toEqual([1, 2, 3])
  })

  it("a log written before epochs were recorded is continued: its entries count as epoch 0", async () => {
    appendLineDurable(
      join(root, WAL_FILE),
      JSON.stringify({
        seq: 1,
        kind: "create",
        locator: "notes/old.md",
        previousHash: null,
        newHash: "b".repeat(64),
        auditId: "old",
        source: "test",
        reason: "old",
        timestamp: new Date().toISOString(),
      }),
    )
    const writer = new VaultMutationWriter({ root })
    await writer.apply(createIntent("notes/new.md"))
    const entries = walEntries(root)
    expect(entries[0]?.epoch).toBeUndefined()
    expect(entries[1]?.epoch).toBe(1)
  })

  it("asserting a lock that is not held is refused", () => {
    expect(() => new WriteLock(join(root, LOCK_FILE)).assertHeld()).toThrow(/taken by another writer|not held/)
  })
})
