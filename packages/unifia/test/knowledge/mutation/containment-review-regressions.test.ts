/* SPDX-License-Identifier: MIT */
/**
 * Regressions from the independent review of the containment head (ADR-092, "Independent review of head 75264c717" and the
 * follow-up on 43a46b550). Each describe names the defect it pins. Each one fails on 43a46b550 and passes once its fix is in.
 *
 * Crash fixtures are states a real crash can leave: a temporary beside a destination that still holds the pre-write bytes
 * (an atomic rename has not landed), a WAL line for the write, and a write lock whose owner is dead.
 */

import { afterEach, describe, it, expect } from "bun:test"
import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TMP_SUFFIX, WriteLock, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE, TRASH_DIR, VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"

const WRITER = join(import.meta.dir, "..", "..", "..", "src", "knowledge", "mutation", "writer.ts")
const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const ID = "0190d2c0-7b00-7000-8000-000000000001"
/** A pid the kernel cannot have allocated: its holder is verifiably dead. */
const DEAD_PID = 2_147_483_646

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex")

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A vault root with its own folder, in a fresh directory that the test removes afterwards. */
function freshVault(): string {
  const base = mkdtempSync(join(tmpdir(), "unifia-containment-"))
  made.push(base)
  const root = join(base, "vault")
  mkdirSync(join(root, ".unifia"), { recursive: true })
  return root
}

/** A note with valid frontmatter for ID, and the given body. */
function note(body: string, id: string = ID): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${id}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "candidate"',
    'unifia_created_at: "2026-08-31T00:00:00Z"',
    'unifia_updated_at: "2026-08-31T00:00:00Z"',
    'unifia_project_ref: "test"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    body,
    "",
  ].join("\n")
}

/** One WAL line, as the writer records it. */
function walLine(seq: number, fields: Record<string, unknown>): string {
  return JSON.stringify({
    seq,
    kind: "update",
    auditId: `audit-${seq}`,
    source: "test",
    reason: "test",
    timestamp: "2026-08-31T00:00:00Z",
    ...fields,
  })
}

/** The lock a writer leaves when it dies mid-commit. */
function plantDeadLock(root: string): void {
  writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: DEAD_PID, at: new Date().toISOString() }))
}

function updateIntent(id: string, expected: string, body: string) {
  return {
    intent: {
      kind: "update",
      targetId: id,
      expectedVersionHash: expected,
      newContent: { type: "decision", restrictions: OPEN, body },
      reason: "test",
      source: "test",
    },
    reason: "test",
    source: "test",
  }
}

// Root cause (L2): the lock holder is read with a plain readFileSync. A named pipe at the lock path is opened for reading
// and blocks until a writer appears, so apply() never returns. Fix: read the lock through readNoFollow, which opens without
// blocking, and treat any non-regular lock as held.

describe("L2: a named pipe at the write lock path does not block the writer", () => {
  it.skipIf(process.platform === "win32")("the open and a create both return with a pipe at the lock path", () => {
    const root = freshVault()
    expect(spawnSync("mkfifo", [join(root, LOCK_FILE)]).status).toBe(0)
    const script = `
      const { VaultMutationWriter } = await import(${JSON.stringify(WRITER)})
      const open = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" }
      const writer = new VaultMutationWriter({ root: ${JSON.stringify(root)} })
      console.log("opened")
      try {
        await writer.apply({
          intent: { kind: "create", targetLocator: "n.md", newContent: { type: "decision", restrictions: open, body: "b" }, reason: "t", source: "t" },
          reason: "t", source: "t",
        })
      } catch {}
      console.log("finished")
    `
    // A blocked read never returns: the timeout stops the child, and the "finished" line is missing.
    const run = spawnSync(process.execPath, ["-e", script], { timeout: 20_000, encoding: "utf8" })
    expect(run.stdout).toContain("finished")
    expect(existsSync(join(root, "n.md"))).toBe(false)
  })
})

// Root cause (R1): recovery renames a pending temporary over the destination whenever the WAL names the note, without
// checking what the destination holds. A user edit made after the crash is replaced. Fix: complete the rename only when the
// destination is absent (create, restore, move) or holds the previous bytes the write replaced (update); a destination holding
// anything else leaves the temporary and the WAL in place and is reported as a conflict.

describe("R1: recovery does not write over a destination that holds other bytes", () => {
  it("a user edit made after the crash survives the open and the next open, and the pending write is kept as a conflict", () => {
    const root = freshVault()
    const before = note("old")
    const pending = note("pending agent write")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    plantDeadLock(root)
    writeFileSync(join(root, "n.md"), note("USER EDIT after the crash"))

    const first = new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toContain("USER EDIT after the crash")
    expect(first.recovery().completed).toEqual([])
    expect(first.recovery().conflicts).toHaveLength(1)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)

    new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toContain("USER EDIT after the crash")
  })

  it("a crash before the rename completes an update whose destination still holds the previous bytes", () => {
    const root = freshVault()
    const before = note("old")
    const pending = note("pending agent write")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().completed).toHaveLength(1)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
  })
})

// Root cause (R2, R3): recovery takes a note's bytes from its newest entry that carries content and ignores later deletes and
// moves away. Fix: the latest WAL entry touching the note (a write at it, a delete at it, or a move away from it) decides. A
// temporary completes only when that entry is the write whose bytes it holds.

describe("R2 and R3: a later delete or move of a note is not undone by a pending write of it", () => {
  /** The state a failed rename leaves: the previous bytes visible, the new bytes in a temporary, and the WAL line for them. */
  function pendingWriteOfNote(): { root: string; before: string } {
    const root = freshVault()
    const before = note("old")
    const pending = note("failed rename write")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    return { root, before }
  }

  it("a delete after the pending write is not undone by the next open", async () => {
    const { root, before } = pendingWriteOfNote()
    const live = new VaultMutationWriter({ root, recoverOnOpen: false })
    await live.apply({
      intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(before), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    expect(existsSync(join(root, "n.md"))).toBe(false)

    const reopened = new VaultMutationWriter({ root })
    expect(existsSync(join(root, "n.md"))).toBe(false)
    expect(reopened.recovery().completed).toEqual([])
  })

  it("a delete committed to the WAL whose unlink did not run is not undone by the next open", () => {
    // The state a crash leaves between the delete's WAL line and its unlink: the note still holds the bytes it had, so the
    // destination alone would allow the pending write to land. The later delete is what decides.
    const { root, before } = pendingWriteOfNote()
    const pending = readFileSync(join(root, `n.md${TMP_SUFFIX}`), "utf8")
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, { kind: "delete", locator: "n.md", previousHash: sha(before), newHash: null }),
    )
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().completed).toEqual([])
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(before)
    expect(readFileSync(join(root, `n.md${TMP_SUFFIX}`), "utf8")).toBe(pending)
  })

  it("a move after the pending write leaves the old path empty, and the moved note keeps the bytes it had", async () => {
    const { root, before } = pendingWriteOfNote()
    const live = new VaultMutationWriter({ root, recoverOnOpen: false })
    await live.apply({
      intent: {
        kind: "move",
        targetId: ID,
        targetLocator: "m.md",
        expectedVersionHash: sha(before),
        reason: "test",
        source: "test",
      },
      reason: "test",
      source: "test",
    })

    const reopened = new VaultMutationWriter({ root })
    expect(existsSync(join(root, "n.md"))).toBe(false)
    expect(readFileSync(join(root, "m.md"), "utf8")).toBe(before)
    expect(reopened.recovery().completed).toEqual([])
  })
})

// Root cause (R4): a writer that dies leaves the lock file; every later open then reads the lock as a crash and runs the
// move-source pass again, which unlinks a source the user has since recreated byte-identical. Fix: the open that recovers
// takes the lock (reclaiming the dead owner's), runs the pass once, and releases the lock, which removes the crash marker.

describe("R4: a source the user recreates after a crash is kept on later opens", () => {
  it("the open after the crash removes the leftover source once; a later open keeps the same bytes written back at that path", () => {
    const root = freshVault()
    const body = note("the moved note")
    mkdirSync(join(root, "notes"), { recursive: true })
    writeFileSync(join(root, "notes", "b.md"), body)
    writeFileSync(join(root, "notes", "a.md"), body)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, {
        kind: "move",
        locator: "notes/b.md",
        previousLocator: "notes/a.md",
        previousHash: sha(body),
        newHash: sha(body),
      }),
    )
    plantDeadLock(root)

    new VaultMutationWriter({ root })
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
    // The open took over the dead holder's lock and released it: the crash marker is gone.
    expect(existsSync(join(root, LOCK_FILE))).toBe(false)

    writeFileSync(join(root, "notes", "a.md"), body)
    new VaultMutationWriter({ root })
    expect(existsSync(join(root, "notes", "a.md"))).toBe(true)
  })
})

// Root cause (L6): the open runs recovery without the write lock, so it treats a live holder's temporary as a crash leftover.
// Fix: the open takes the lock first; a live holder keeps the lock, and recovery is left to it.

describe("L6: an open does not discard or complete a live writer's temporary", () => {
  it("a temporary with no WAL line, under a lock held by a live process, survives another open", () => {
    const root = freshVault()
    const before = note("old")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), note("in flight, before the commit point"))
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))

    const writer = new VaultMutationWriter({ root })
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)
    expect(writer.recovery().discarded).toEqual([])
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(before)
    expect(existsSync(join(root, LOCK_FILE))).toBe(true)
  })

  it("a committed temporary under a lock held by a live process is not completed by another open", () => {
    const root = freshVault()
    const before = note("old")
    const pending = note("committed, before the rename")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().completed).toEqual([])
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(before)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)
    expect(existsSync(join(root, LOCK_FILE))).toBe(true)
  })
})

// Root cause (L4): readWalTolerant parses any JSON, so a line of `null` (or a number, an array, a string) reaches recovery,
// which reads its fields: `e.locator` throws. Also a move whose previousLocator is not a string throws in the pass that
// reads it. Fix: a non-object line is set aside and counted as malformed; recovery checks the field types it reads.

describe("L4: a WAL line that is not an object is set aside, and the vault still opens", () => {
  it("non-object lines do not stop the open, and the entries beside them recover", () => {
    const root = freshVault()
    const content = note("beside the bad lines")
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), content)
    writeFileSync(
      join(root, WAL_FILE),
      [
        "null",
        "5",
        "[]",
        '"text"',
        walLine(2, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(content) }),
      ].join("\n") + "\n",
    )

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().truncatedWalLines).toBe(4)
    expect(writer.recovery().completed).toHaveLength(1)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
  })

  it("a move whose previousLocator is not a string does not stop the open", () => {
    const root = freshVault()
    const body = note("kept")
    writeFileSync(join(root, "m.md"), body)
    writeFileSync(
      join(root, WAL_FILE),
      walLine(1, { kind: "move", locator: "m.md", previousLocator: 5, previousHash: sha(body), newHash: sha(body) }) + "\n",
    )
    plantDeadLock(root)

    expect(() => new VaultMutationWriter({ root })).not.toThrow()
    expect(readFileSync(join(root, "m.md"), "utf8")).toBe(body)
  })
})

// Root cause (L7): locate() accepts any note the walk reaches, including one reached through an in-vault alias into the trash.
// resolveWritable refuses the vault's own folder, locate does not. Fix: locate refuses a note whose real place is the vault's
// own folder, under the same refusal.

describe("L7: an update through an in-vault alias does not rewrite a trashed note", () => {
  it.skipIf(process.platform === "win32")("the update is refused, and the trash file is byte-identical afterwards", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const current = note("to trash")
    writeFileSync(join(root, "n.md"), current)
    const deleted = await writer.apply({
      intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(current), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    const trashed = join(root, TRASH_DIR, `${deleted.auditId}.md`)
    const before = readFileSync(trashed)
    symlinkSync(join(root, ".unifia"), join(root, "alias"), "dir")

    let refused = false
    try {
      await writer.apply(updateIntent(ID, sha(before.toString("utf8")), "written into the trash"))
    } catch {
      refused = true
    }
    expect(refused).toBe(true)
    expect(readFileSync(trashed).equals(before)).toBe(true)
  })

  it.skipIf(process.platform === "win32")("a supersede that names a trashed note as its successor does not rewrite the trash", async () => {
    const root = freshVault()
    const TARGET_ID = "0190d2c0-7b00-7000-8000-000000000002"
    const active = (body: string, id: string) => note(body, id).replace('unifia_lifecycle: "candidate"', 'unifia_lifecycle: "active"')
    writeFileSync(join(root, "target.md"), active("the superseded note", TARGET_ID))
    const trashedCurrent = active("the trashed successor", ID)
    writeFileSync(join(root, "n.md"), trashedCurrent)
    const writer = new VaultMutationWriter({ root })
    const deleted = await writer.apply({
      intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(trashedCurrent), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    const trashed = join(root, TRASH_DIR, `${deleted.auditId}.md`)
    const before = readFileSync(trashed)
    symlinkSync(join(root, ".unifia"), join(root, "alias"), "dir")

    let refused = false
    try {
      await writer.apply({
        intent: {
          kind: "supersede",
          targetId: TARGET_ID,
          successorId: ID,
          expectedVersionHash: sha(readFileSync(join(root, "target.md"), "utf8")),
          reason: "test",
          source: "test",
        },
        reason: "test",
        source: "test",
      })
    } catch {
      refused = true
    }
    expect(refused).toBe(true)
    expect(readFileSync(trashed).equals(before)).toBe(true)
  })
})
