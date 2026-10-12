/* SPDX-License-Identifier: MIT */
/**
 * The durable order of a commit, and what the next open finds after a writer dies between its steps.
 *
 * The order is: the lock is durable before the first log line; the log line is durable before the rename of the temporary; the lock is
 * removed only after the commit is complete. Each crash test kills a real writer process with SIGKILL at one step, reopens the vault,
 * and checks the outcome the log says it must have. The in-process tests check the order itself.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { VaultMutationWriter, LOCK_FILE, WAL_FILE, type CommitStep } from "../../../src/knowledge/mutation/writer.js"
import { parseLock } from "../../../src/knowledge/mutation/lock-record.js"

const CHILD = join(import.meta.dir, "write-lock-child.ts")
const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const

interface Seed {
  id: string
  versionHash: string
}

async function freshVaultWithNote(): Promise<{ root: string; dir: string; seed: Seed }> {
  const root = mkdtempSync(join(tmpdir(), "unifia-crash-order-"))
  mkdirSync(join(root, ".unifia"), { recursive: true })
  mkdirSync(join(root, "notes"), { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), "unifia-crash-order-dir-"))
  const seeded = await new VaultMutationWriter({ root }).apply({
    intent: {
      kind: "create",
      targetLocator: "notes/a.md",
      newContent: { type: "decision", restrictions: OPEN, body: "original" },
      reason: "seed",
      source: "test",
    },
    reason: "seed",
    source: "test",
  })
  return { root, dir, seed: { id: String(seeded.ref?.id), versionHash: String(seeded.ref?.versionHash) } }
}

/** The mutations under test: a create of a new note, and a move of the seeded note. */
function intentFor(kind: "create" | "move", seed: Seed): Record<string, unknown> {
  if (kind === "create") {
    return {
      kind: "create",
      targetLocator: "notes/new.md",
      newContent: { type: "decision", restrictions: OPEN, body: "fresh" },
      reason: "crash",
      source: "test",
    }
  }
  return {
    kind: "move",
    targetId: seed.id,
    targetLocator: "notes/moved.md",
    expectedVersionHash: seed.versionHash,
    reason: "crash",
    source: "test",
  }
}

/** Run the mutation in a child that kills itself with SIGKILL at `step`. Returns the signal the child died of. */
function killedAt(root: string, dir: string, intent: Record<string, unknown>, step: CommitStep): string | null {
  const specPath = join(dir, `spec-${step}.json`)
  writeFileSync(specPath, JSON.stringify({ mode: "write", root, dir, id: "k", intent, killAt: step }))
  const proc = Bun.spawnSync([process.execPath, CHILD, specPath], { stdout: "pipe", stderr: "pipe" })
  return proc.signalCode ?? null
}

function walLines(root: string): number {
  const path = join(root, WAL_FILE)
  if (!existsSync(path)) return 0
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0).length
}

function tmpCount(root: string): number {
  return ["notes/new.md", "notes/moved.md", "notes/a.md"].filter((p) => existsSync(join(root, p) + ".unifia-tmp")).length
}

/**
 * What the vault must hold once a crash at `step` has been finished by the next open. For a create the new note is in or out; for a
 * move the moved note is in and the source is gone, or nothing has moved and the source is still there.
 */
const EXPECTED: Record<"create" | "move", Record<CommitStep, { committed: boolean; logged: number }>> = {
  create: {
    "lock-durable": { committed: false, logged: 1 },
    "temporary-durable": { committed: false, logged: 1 },
    "wal-durable": { committed: true, logged: 2 },
    renamed: { committed: true, logged: 2 },
    "previous-removed": { committed: true, logged: 2 },
  },
  move: {
    "lock-durable": { committed: false, logged: 1 },
    "temporary-durable": { committed: false, logged: 1 },
    "wal-durable": { committed: true, logged: 2 },
    renamed: { committed: true, logged: 2 },
    "previous-removed": { committed: true, logged: 2 },
  },
}

describe("crash between each step of a commit: the next open finishes or discards it", () => {
  let root: string
  let dir: string
  let seed: Seed
  beforeEach(async () => {
    ;({ root, dir, seed } = await freshVaultWithNote())
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  const steps: CommitStep[] = ["lock-durable", "temporary-durable", "wal-durable", "renamed", "previous-removed"]

  for (const kind of ["create", "move"] as const) {
    for (const step of steps) {
      it(`${kind}: a kill at ${step} leaves the state the log describes after the next open`, async () => {
        expect(killedAt(root, dir, intentFor(kind, seed), step)).toBe("SIGKILL")

        // The dead writer's lock is still on disk: the next open takes it over, finishes the recovery and releases it.
        expect(existsSync(join(root, LOCK_FILE))).toBe(true)
        new VaultMutationWriter({ root })
        expect(existsSync(join(root, LOCK_FILE))).toBe(false)

        const want = EXPECTED[kind][step]
        if (kind === "create") {
          expect(existsSync(join(root, "notes", "new.md"))).toBe(want.committed)
          if (want.committed) expect(readFileSync(join(root, "notes", "new.md"), "utf8")).toContain("fresh")
        } else if (want.committed) {
          expect(existsSync(join(root, "notes", "moved.md"))).toBe(true)
          expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
        } else {
          expect(existsSync(join(root, "notes", "a.md"))).toBe(true)
          expect(existsSync(join(root, "notes", "moved.md"))).toBe(false)
        }
        expect(walLines(root)).toBe(want.logged)
        expect(tmpCount(root)).toBe(0)

        // The vault is writable again: a later write needs no manual step.
        const later = await new VaultMutationWriter({ root }).apply({
          intent: {
            kind: "create",
            targetLocator: "notes/after.md",
            newContent: { type: "decision", restrictions: OPEN, body: "after" },
            reason: "after",
            source: "test",
          },
          reason: "after",
          source: "test",
        })
        expect(later.applied).toBe(true)
      })
    }
  }
})

describe("the order of a commit, in one process", () => {
  let root: string
  let seed: Seed
  beforeEach(async () => {
    ;({ root, seed } = await freshVaultWithNote())
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("the lock is present, and held by this writer, at every step; it is removed only after the commit completes", async () => {
    const lockPath = join(root, LOCK_FILE)
    const seen: Array<{ step: CommitStep; lockPresent: boolean; lockOwnedHere: boolean }> = []
    const writer = new VaultMutationWriter({
      root,
      hooks: {
        atStep: (step) => {
          const present = existsSync(lockPath)
          const text = present ? readFileSync(lockPath, "utf8") : ""
          const parsed = present ? parseLock(text) : null
          seen.push({
            step,
            lockPresent: present,
            lockOwnedHere: parsed?.kind === "record" && parsed.record.pid === process.pid,
          })
        },
      },
    })
    await writer.apply({
      intent: {
        kind: "move",
        targetId: seed.id,
        targetLocator: "notes/moved.md",
        expectedVersionHash: seed.versionHash,
        reason: "order",
        source: "test",
      },
      reason: "order",
      source: "test",
    })

    expect(seen.map((s) => s.step)).toEqual(["lock-durable", "temporary-durable", "wal-durable", "renamed", "previous-removed"])
    // The lock is a durable, owned record from its first step on, so no log line exists without it.
    expect(seen.every((s) => s.lockPresent && s.lockOwnedHere)).toBe(true)
    // Removed only after the commit: the move is complete on disk when the lock goes.
    expect(existsSync(lockPath)).toBe(false)
    expect(existsSync(join(root, "notes", "moved.md"))).toBe(true)
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
  })

  it("the log line is written after the temporary, and the rename after the log line", async () => {
    const order: string[] = []
    const writer = new VaultMutationWriter({
      root,
      hooks: {
        atStep: (step) => {
          order.push(step)
          if (step === "temporary-durable") expect(existsSync(join(root, "notes", "new.md.unifia-tmp"))).toBe(true)
          if (step === "wal-durable") {
            expect(readFileSync(join(root, WAL_FILE), "utf8")).toContain('"kind":"create"')
            expect(existsSync(join(root, "notes", "new.md"))).toBe(false)
          }
        },
      },
    })
    await writer.apply({
      intent: {
        kind: "create",
        targetLocator: "notes/new.md",
        newContent: { type: "decision", restrictions: OPEN, body: "fresh" },
        reason: "order",
        source: "test",
      },
      reason: "order",
      source: "test",
    })
    expect(order).toEqual(["lock-durable", "temporary-durable", "wal-durable", "renamed", "previous-removed"])
  })
})
