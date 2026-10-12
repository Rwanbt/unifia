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
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TMP_SUFFIX, WriteLock, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE, TRASH_DIR, VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

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
function note(body: string, id: string = ID, lifecycle: string = "candidate"): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${id}"`,
    'unifia_type: "decision"',
    `unifia_lifecycle: "${lifecycle}"`,
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

/**
 * The lock a writer leaves when it dies mid-commit. `inFlightSeq` is the sequence number a move or restore recorded before its
 * entry was appended; a crash before any move records none.
 */
function plantDeadLock(root: string, inFlightSeq?: number): void {
  const recorded = inFlightSeq === undefined ? {} : { seq: inFlightSeq }
  writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: DEAD_PID, at: new Date().toISOString(), ...recorded }))
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
  function pendingWriteOfNote(): { root: string; before: string; pending: string } {
    const root = freshVault()
    const before = note("old")
    const pending = note("failed rename write")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    return { root, before, pending }
  }

  // Changed expectation (item A): the delete below was planned on the bytes the note shows, which the committed write superseded.
  // It is now refused as stale, after the committed write completes, so the note keeps the committed bytes. Before, the delete was
  // applied and trashed the superseded bytes; that is the defect A names. The R2 property is unchanged: a later open does not undo.
  it("a delete after the pending write is not undone by the next open", async () => {
    const { root, before, pending } = pendingWriteOfNote()
    const live = new VaultMutationWriter({ root, recoverOnOpen: false })
    await expect(
      live.apply({
        intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(before), reason: "test", source: "test" },
        reason: "test",
        source: "test",
      }),
    ).rejects.toMatchObject({ kind: "cas_mismatch" })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)

    const reopened = new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(reopened.recovery().completed).toEqual([])
  })

  it("a delete planned on the committed bytes is applied, and the next open does not undo it", async () => {
    const { root, pending } = pendingWriteOfNote()
    // The open completes the committed write, so the bytes the caller reads are the committed ones.
    const opened = new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    await opened.apply({
      intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(pending), reason: "test", source: "test" },
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

  // Changed expectation (item A, as for the delete above): a move planned on the superseded bytes is refused as stale. Before, the
  // move carried the superseded bytes to m.md and left the committed write stranded. The R3 property is unchanged.
  it("a move planned on the superseded bytes is refused, and the next open does not undo the pending write", async () => {
    const { root, before, pending } = pendingWriteOfNote()
    const live = new VaultMutationWriter({ root, recoverOnOpen: false })
    await expect(
      live.apply({
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
      }),
    ).rejects.toMatchObject({ kind: "cas_mismatch" })

    const reopened = new VaultMutationWriter({ root })
    expect(existsSync(join(root, "m.md"))).toBe(false)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(reopened.recovery().completed).toEqual([])
  })

  it("a move planned on the committed bytes keeps them at the new path, and the old path stays empty", async () => {
    const { root, pending } = pendingWriteOfNote()
    const opened = new VaultMutationWriter({ root })
    await opened.apply({
      intent: {
        kind: "move",
        targetId: ID,
        targetLocator: "m.md",
        expectedVersionHash: sha(pending),
        reason: "test",
        source: "test",
      },
      reason: "test",
      source: "test",
    })

    const reopened = new VaultMutationWriter({ root })
    expect(existsSync(join(root, "n.md"))).toBe(false)
    expect(readFileSync(join(root, "m.md"), "utf8")).toBe(pending)
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
    // The writer died in the move: its lock names the move's sequence number (seq 1).
    plantDeadLock(root, 1)

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

// Root cause (L10): reclaimIfStale judges the lock by the pid it reads, then unlinks the path. A lock written by another
// writer between the judgement and the unlink is removed with the dead one. Fix: re-read the lock through the no-follow reader
// after the judgement, and unlink only when it is the same lock that was judged. The window is made deterministic by a hook
// the lock calls between the judgement and the re-read; the hook is a no-op in production.

describe("L10: reclaiming a dead holder's lock removes only the lock that was judged", () => {
  it("a lock replaced between the judgement and the unlink is left in place, and the attempt is refused", () => {
    const root = freshVault()
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
    const replacement = JSON.stringify({ pid: process.pid, at: new Date().toISOString() })
    const lock = new WriteLock(path, { afterJudgement: () => writeFileSync(path, replacement) })

    expect(() => lock.acquire()).toThrow(/locked by another writer/)
    expect(readFileSync(path, "utf8")).toBe(replacement)
  })
})

// Root cause (L1): the expected-version check runs in locate(), before the write lock is taken. A second writer can commit
// between that read and the commit, and the first writer then commits over a version it did not see. Fix: re-verify the state
// the write was planned against, under the write lock, immediately before the WAL append and the rename; a mismatch is refused.

describe("L1: an update planned on a version another writer has already replaced is refused", () => {
  it("a commit by another writer between this writer's read and its commit makes this update a refusal", async () => {
    const root = freshVault()
    writeFileSync(join(root, "n.md"), note("base"))
    const base = readFileSync(join(root, "n.md"), "utf8")
    const expected = sha(base)
    const writer = new VaultMutationWriter({ root })
    const other = new VaultMutationWriter({ root })

    // The read of `locate` happens here; the other writer commits before this writer reaches its commit.
    const locate = (writer as unknown as { locate: (id?: string) => Promise<unknown> }).locate.bind(writer)
    let interleaved = false
    ;(writer as unknown as { locate: unknown }).locate = async (id?: string) => {
      const found = await locate(id)
      if (!interleaved) {
        interleaved = true
        await other.apply(updateIntent(ID, expected, "the other writer"))
      }
      return found
    }

    await expect(writer.apply(updateIntent(ID, expected, "this writer"))).rejects.toThrow()
    expect(writer.readWal().filter((e) => e.kind === "update" && e.previousHash === expected)).toHaveLength(1)
    expect(readFileSync(join(root, "n.md"), "utf8")).toContain("the other writer")
  })

  it.skipIf(process.platform === "win32")(
    "two processes updating one note from the same base: no version is the previous hash of two committed updates",
    async () => {
      const root = freshVault()
      writeFileSync(join(root, "n.md"), note("base"))
      const childScript = (tag: string) => `
        const { readFileSync } = await import("node:fs")
        const { join } = await import("node:path")
        const { createHash } = await import("node:crypto")
        const { VaultMutationWriter } = await import(${JSON.stringify(WRITER)})
        const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex")
        const open = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" }
        const file = join(${JSON.stringify(root)}, "n.md")
        const writer = new VaultMutationWriter({ root: ${JSON.stringify(root)} })
        let applied = 0
        for (let i = 0; i < 120; i++) {
          const raw = readFileSync(file, "utf8")
          try {
            await writer.apply({
              intent: { kind: "update", targetId: ${JSON.stringify(ID)}, expectedVersionHash: sha(raw),
                newContent: { type: "decision", restrictions: open, body: ${JSON.stringify(tag)} + "-" + i }, reason: "t", source: "t" },
              reason: "t", source: "t",
            })
            applied += 1
          } catch {}
        }
        console.log("applied " + applied)
      `
      const [a, b] = await Promise.all([runScript(childScript("A")), runScript(childScript("B"))])
      expect(a).toContain("applied")
      expect(b).toContain("applied")

      const updates = readFileSync(join(root, WAL_FILE), "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { kind: string; previousHash: string | null })
        .filter((e) => e.kind === "update")
      const byPrevious = new Map<string | null, number>()
      for (const e of updates) byPrevious.set(e.previousHash, (byPrevious.get(e.previousHash) ?? 0) + 1)
      expect([...byPrevious.values()].filter((count) => count > 1)).toEqual([])
      expect(updates.length).toBeGreaterThan(0)
    },
    120_000,
  )
})

/** Run `script` in a child Bun process, and resolve with its output once it exits (or after a minute). */
function runScript(script: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    const timer = setTimeout(() => child.kill(), 60_000)
    child.on("close", () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

// Root cause (L9): a rename that fails after the WAL line leaves the committed temporary beside the note. Every later write to
// that note stages its own temporary at the same name, which the exclusive create refuses, until the next open completes it.
// Fix: a write first completes a leftover temporary under the write lock, through the same recovery an open runs, and only then
// checks its own expected state. The failed rename itself is not reproduced in-process; the state it leaves is.

describe("L9: a leftover temporary of a failed commit does not refuse later writes until the next open", () => {
  it("the next write completes the committed leftover, and then judges its own expected version", async () => {
    const root = freshVault()
    const before = note("old")
    const pending = note("committed, the rename failed")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    const writer = new VaultMutationWriter({ root, recoverOnOpen: false })

    // The caller that saw the failure still plans against the bytes it read before the commit: a stale expectation.
    const stale = writer.apply(updateIntent(ID, sha(before), "planned on the old bytes"))
    await expect(stale).rejects.toMatchObject({ kind: "cas_mismatch" })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)

    // A write planned on the version that did land is accepted, without a reopen.
    await writer.apply(updateIntent(ID, sha(pending), "planned on the landed bytes"))
    expect(readFileSync(join(root, "n.md"), "utf8")).toContain("planned on the landed bytes")
  })
})

// Root cause (A): remove and move check the note's expected hash under the write lock but never complete a leftover temporary
// at the note first, so they act on the bytes the note held before a committed write whose rename did not land. The delete
// trashed those bytes and the move carried them away, and the committed write was left stranded as a conflict. Fix: each path
// that checks a note completes its leftover under the lock before the check, as commit already does.

describe("A: a delete or a move planned on superseded bytes is refused, and the previous bytes are not trashed or moved", () => {
  /** A committed update whose rename did not land: the note holds the previous bytes, the temporary the committed ones. */
  function stagedUpdate(root: string): { before: string; pending: string } {
    const before = note("older version")
    const pending = note("committed write, rename failed")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    return { before, pending }
  }

  /** The writer opens while a live holder keeps the lock, so recovery is left to it; then the holder dies. */
  function openUnderLiveHolderThenDie(root: string): VaultMutationWriter {
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    const writer = new VaultMutationWriter({ root })
    plantDeadLock(root)
    return writer
  }

  function trashedNotes(root: string): string[] {
    const dir = join(root, TRASH_DIR)
    return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")) : []
  }

  it("a delete planned on the previous bytes is refused, and nothing is trashed", async () => {
    const root = freshVault()
    const { before, pending } = stagedUpdate(root)
    const writer = openUnderLiveHolderThenDie(root)

    const stale = writer.apply({
      intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(before), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    await expect(stale).rejects.toMatchObject({ kind: "cas_mismatch" })
    expect(trashedNotes(root)).toEqual([])
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    expect(new VaultMutationWriter({ root }).recovery().conflicts).toEqual([])
  })

  it("a move planned on the previous bytes is refused, and the previous path keeps the committed bytes", async () => {
    const root = freshVault()
    const { before, pending } = stagedUpdate(root)
    const writer = openUnderLiveHolderThenDie(root)

    const stale = writer.apply({
      intent: { kind: "move", targetId: ID, targetLocator: "m.md", expectedVersionHash: sha(before), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    await expect(stale).rejects.toMatchObject({ kind: "cas_mismatch" })
    expect(existsSync(join(root, "m.md"))).toBe(false)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    expect(new VaultMutationWriter({ root }).recovery().conflicts).toEqual([])
  })

  // A guard, not a failing case: the outcome on the previous head was also a refusal. It pins that a restore into a name with a
  // committed create that did not land is refused, and that the trashed note stays in the trash.
  it("a restore into a name whose committed create did not land is refused, and the trashed note stays trashed", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const trashedBody = note("trashed note")
    writeFileSync(join(root, "n.md"), trashedBody)
    const deleted = await writer.apply({
      intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(trashedBody), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    const pending = note("committed create", "0190d2c0-7b00-7000-8000-000000000002")
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(pending) }),
    )

    const live = new VaultMutationWriter({ root, recoverOnOpen: false })
    await expect(live.restoreDeleted(deleted.auditId)).rejects.toMatchObject({ kind: "cas_mismatch" })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(live.trash()).toHaveLength(1)
  })
})

// Root cause (B): a conflict left by recovery is recorded in RecoveryReport.conflicts and nowhere else. Every write to the name is
// refused with a generic "already present" message, and no operator-facing surface lists the note. Fix: a write at a name with a
// pending conflict is refused with a message that names the note's locator, and the knowledge doctor lists the pending conflicts
// through a read-only scan. Nothing resolves a conflict: that is the owner's decision.

describe("B: a pending conflict is named where it blocks a write, and the doctor lists it", () => {
  /** A committed update whose rename did not land, and then the user's own edit at the note: a conflict recovery keeps in place. */
  function conflictedNote(): { root: string; edit: string } {
    const root = freshVault()
    const before = note("old")
    const pending = note("committed write, rename failed")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    const edit = note("USER EDIT after the crash")
    writeFileSync(join(root, "n.md"), edit)
    return { root, edit }
  }

  it("a write refused at a conflicted name names the note, and no absolute path", async () => {
    const { root, edit } = conflictedNote()
    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().conflicts).toHaveLength(1)

    const refused = writer.apply(updateIntent(ID, sha(edit), "a write on the edited bytes"))
    const error = await refused.then(
      () => null,
      (e: unknown) => e as { kind?: string; message?: string },
    )
    expect(error?.kind).toBe("mutation_refused")
    expect(error?.message).toContain("n.md")
    expect(error?.message).toMatch(/did not complete/)
    expect(error?.message).not.toContain(root)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(edit)
  })

  it("the doctor lists the pending conflict by its locator, and the scan changes nothing", async () => {
    const { root } = conflictedNote()
    const { doctor } = await import("../../../src/knowledge/admin/doctor.js")
    const writerModule = await import("../../../src/knowledge/mutation/writer.js")
    const walBefore = readFileSync(join(root, WAL_FILE), "utf8")

    const pending = writerModule.pendingWriteConflicts(root)
    expect(pending).toEqual(["n.md"])
    const report = doctor({
      byId: new Map(),
      knownLocators: new Set(),
      edges: [],
      index: { rebuiltAt: new Date().toISOString(), candidatesCount: 0 },
      indexedLocators: new Set(),
      pendingConflicts: pending as never,
    })
    expect(report.findings).toEqual([
      expect.objectContaining({ category: "pending_conflict", locator: "n.md" }),
    ])
    expect(readFileSync(join(root, `n.md${TMP_SUFFIX}`), "utf8")).toContain("committed write, rename failed")
    expect(readFileSync(join(root, WAL_FILE), "utf8")).toBe(walBefore)
  })

  it("a vault that does not exist has no pending conflict, and the scan creates nothing", async () => {
    const base = mkdtempSync(join(tmpdir(), "unifia-containment-"))
    made.push(base)
    const writerModule = await import("../../../src/knowledge/mutation/writer.js")
    expect(writerModule.pendingWriteConflicts(join(base, "absent"))).toEqual([])
    expect(existsSync(join(base, "absent"))).toBe(false)
  })
})

// Root cause (D): the move-source pass runs on every reclaim of a dead lock, and reads the whole WAL. A move that completed long ago
// has its source unlinked, so the pass finds nothing; once the user restores that source byte-identical, a later reclaim of an
// unrelated dead lock unlinks it. Fix: a commit records its sequence number in the lock before it appends a move or restore, and
// the pass finishes only the entry with the number the reclaimed lock records. A lock with no number finishes no move.

describe("D: a completed move is not finished again by a later reclaim of an unrelated dead lock", () => {
  it("a source the user restores identically after a completed move survives the open that reclaims an unrelated lock", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    await writer.apply({
      intent: {
        kind: "create",
        targetId: ID,
        targetLocator: "notes/a.md",
        newContent: { type: "decision", restrictions: OPEN, body: "the moved note" },
        reason: "test",
        source: "test",
      },
      reason: "test",
      source: "test",
    })
    const raw = readFileSync(join(root, "notes", "a.md"), "utf8")
    await writer.apply({
      intent: { kind: "move", targetId: ID, targetLocator: "notes/b.md", expectedVersionHash: sha(raw), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)

    // The user restores the old path byte-identical, for example from a checkout.
    writeFileSync(join(root, "notes", "a.md"), raw)
    // An unrelated writer died before it recorded any move, and its lock is reclaimed at the next open.
    plantDeadLock(root)
    new VaultMutationWriter({ root })

    expect(existsSync(join(root, "notes", "a.md"))).toBe(true)
  })

  it("the lock names the move its holder recorded, and the reclaim of a dead holder's lock reports that number", () => {
    const root = freshVault()
    const path = join(root, LOCK_FILE)
    const holder = new WriteLock(path)
    holder.acquire()
    holder.recordInFlight(7)
    // The holder dies with its lock on disk: the recorded pid is dead, and the number it recorded stays.
    const dead = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({ ...dead, pid: DEAD_PID }))

    expect(new WriteLock(path).acquire()).toEqual({ reclaimed: true, inFlightSeq: 7 })
  })
})

// Root cause (E): the open releases the lock in a `finally` even when recovery throws. The lock is the only record that a writer died
// mid-commit, so a failed open consumed the crash: the next open found no lock, and the move the dead writer had in flight kept its
// source. Fix: a recovery that does not return puts the reclaimed lock back as the dead holder left it, so the next open reclaims it.

describe("E: a failed recovery leaves the crash on record for the next open", () => {
  it("the failing open keeps the lock, and an open after the WAL is repaired finishes the move's source", () => {
    const root = freshVault()
    mkdirSync(join(root, "notes"), { recursive: true })
    const body = note("the moved note")
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
    // The WAL has a second name, so it is not read: the open refuses, after it has reclaimed the dead writer's lock.
    const second = join(root, "wal-second-name")
    linkSync(join(root, WAL_FILE), second)
    plantDeadLock(root, 1)

    expect(() => new VaultMutationWriter({ root })).toThrow(/write-ahead log/)
    expect(existsSync(join(root, LOCK_FILE))).toBe(true)
    expect(existsSync(join(root, "notes", "a.md"))).toBe(true)

    // The operator removes the second name; the next open reclaims the same crash and finishes the move's source.
    unlinkSync(second)
    new VaultMutationWriter({ root })
    expect(existsSync(join(root, "notes", "a.md"))).toBe(false)
    expect(existsSync(join(root, LOCK_FILE))).toBe(false)
  })
})

// Root cause (F): supersede writes the successor before it runs the target's own checks. A target that a refusal stops (a pending
// conflict at its name) is refused after the successor already lists it: a refused operation changed a second note. Fix: every check
// of the target runs before the successor's first write, so a refusal of the target writes nothing.

describe("F: a supersede refused on its target writes nothing, not even the successor", () => {
  it("a target held by a pending conflict refuses the supersede, and the successor keeps its bytes", async () => {
    const root = freshVault()
    const successorId = "0190d2c0-7b00-7000-8000-000000000002"
    // An active target: a candidate cannot be superseded, and that transition refusal would hide the case under test.
    const before = note("old", ID, "active")
    const pending = note("committed write, rename failed", ID, "active")
    const edit = note("USER EDIT after the crash", ID, "active")
    writeFileSync(join(root, "target.md"), edit)
    writeFileDurable(join(root, `target.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "target.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    const successor = note("successor", successorId, "active")
    writeFileSync(join(root, "succ.md"), successor)
    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().conflicts).toHaveLength(1)

    await expect(
      writer.apply({
        intent: { kind: "supersede", targetId: ID, successorId, expectedVersionHash: sha(edit), reason: "test", source: "test" },
        reason: "test",
        source: "test",
      }),
    ).rejects.toMatchObject({ kind: "mutation_refused" })
    expect(readFileSync(join(root, "succ.md"), "utf8")).toBe(successor)
    expect(readFileSync(join(root, "target.md"), "utf8")).toBe(edit)
  })
})

// Root cause (I): restoreDeleted reads the trashed note outside the write lock, and the commit then unlinks the trash path
// unconditionally. A purge that lands between the read and the commit is undone: the restore writes the note back from the bytes
// it read, after the purge recorded the erasure. Fix: the trash is read and the restore committed under one lock, so a purge waits
// for it or is refused. The hook runs between the read and the commit; it is a no-op in production.

describe("I: a purge between a restore's read of the trash and its commit is not silently undone", () => {
  it("the purge and the restored note agree: a refused purge leaves the note restored, an applied one leaves it purged", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const trashedBody = note("to trash")
    writeFileSync(join(root, "n.md"), trashedBody)
    const deleted = await writer.apply({
      intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(trashedBody), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })

    const purger = new VaultMutationWriter({ root })
    let purge: Promise<string> | undefined
    const restorer = new VaultMutationWriter({
      root,
      hooks: {
        afterRestoreRead: () => {
          purge = purger.emptyTrash({ confirm: true, auditId: deleted.auditId }).then(
            () => "applied",
            () => "refused",
          )
        },
      },
    })
    await restorer.restoreDeleted(deleted.auditId)

    expect(purge).toBeDefined()
    const outcome = await purge
    expect(existsSync(join(root, "n.md"))).toBe(outcome === "refused")
  })
})

// Root cause (C): the walk skips the vault's own folder by its name only, so a directory alias of another name that points at
// `.unifia` is walked and its trashed notes are listed. resolveWritable judges the text of a locator, so a create through the alias
// lands in the trash. Fix: the walk and resolveWritable judge the real place of each candidate, as locate already does.

describe("C: an alias to the vault's own folder is not listed, and nothing is written through it", () => {
  it.skipIf(process.platform === "win32")(
    "the listing omits the trashed notes behind the alias, and a create through the alias is refused",
    async () => {
      const root = freshVault()
      const writer = new VaultMutationWriter({ root })
      writeFileSync(join(root, "n.md"), note("to trash"))
      await writer.apply({
        intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(note("to trash")), reason: "test", source: "test" },
        reason: "test",
        source: "test",
      })
      expect(readdirSync(join(root, TRASH_DIR)).length).toBeGreaterThan(0)
      symlinkSync(join(root, ".unifia"), join(root, "alias"), "dir")

      const listed = await new VaultSource({ root, space: { kind: "personal", id: "test", label: "test" } }).locators()
      expect(listed).toEqual([])

      const trashBefore = readdirSync(join(root, TRASH_DIR)).sort()
      await expect(
        writer.apply({
          intent: {
            kind: "create",
            targetLocator: "alias/trash/planted.md",
            newContent: { type: "decision", restrictions: OPEN, body: "planted" },
            reason: "test",
            source: "test",
          },
          reason: "test",
          source: "test",
        }),
      ).rejects.toMatchObject({ kind: "mutation_refused" })
      expect(readdirSync(join(root, TRASH_DIR)).sort()).toEqual(trashBefore)
      expect(existsSync(join(root, TRASH_DIR, "planted.md"))).toBe(false)
    },
  )
})

// Root cause (same shape as L4, a second reader of a JSON file the writer keeps): restoreDeleted parses the trash sidecar and reads
// its locator without checking that the parse is an object, so a sidecar of `null`, a number or an array throws a TypeError out of
// the restore. Fix: a sidecar that is not an object with a string locator is refused as nothing in the trash, the refusal a missing
// sidecar already gets.

describe("a trash sidecar that is not an object is refused as nothing in the trash", () => {
  for (const text of ["null", "5", "[]", "not json"]) {
    it(`the sidecar ${JSON.stringify(text)} refuses the restore with a source-inconsistent refusal`, async () => {
      const root = freshVault()
      const writer = new VaultMutationWriter({ root })
      const current = note("to trash")
      writeFileSync(join(root, "n.md"), current)
      const deleted = await writer.apply({
        intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(current), reason: "test", source: "test" },
        reason: "test",
        source: "test",
      })
      writeFileSync(join(root, TRASH_DIR, `${deleted.auditId}.md.origin.json`), text)

      await expect(writer.restoreDeleted(deleted.auditId)).rejects.toMatchObject({ kind: "source_inconsistent" })
      expect(existsSync(join(root, "n.md"))).toBe(false)
    })
  }
})
