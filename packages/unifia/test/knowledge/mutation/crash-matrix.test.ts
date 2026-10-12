/* SPDX-License-Identifier: MIT */
/**
 * The crash matrix of the writer (ADR-092, "Crash matrix"). Each describe is one operation. Each test leaves on disk the state a
 * writer dies in at one point of that operation, then reopens the vault and checks the outcome. Where the point is between two
 * file operations, the state is the files that crash leaves, written by hand; no test kills a process.
 */

import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TMP_SUFFIX, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE, TRASH_DIR, VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const ID = "0190d2c0-7b00-7000-8000-000000000001"
const AUDIT = "0190d2c0-7b00-7000-8000-0000000000a1"
const RESTORE_ID = "0190d2c0-7b00-7000-8000-0000000000b1"
/** A pid the kernel cannot have allocated: its holder is verifiably dead. */
const DEAD_PID = 2_147_483_646

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex")

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A vault root with its own folder, in a fresh directory that the test removes afterwards. */
function freshVault(): string {
  const base = mkdtempSync(join(tmpdir(), "unifia-crash-matrix-"))
  made.push(base)
  const root = join(base, "vault")
  mkdirSync(join(root, ".unifia"), { recursive: true })
  return root
}

/** A note with valid frontmatter for ID, and the given body. */
function note(body: string): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${ID}"`,
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
    auditId: `audit-${seq}`,
    source: "test",
    reason: "test",
    timestamp: "2026-08-31T00:00:00Z",
    ...fields,
  })
}

/** The lock a writer leaves when it dies under the lock. `inFlightSeq` is the number a move or restore recorded before its append. */
function plantDeadLock(root: string, inFlightSeq?: number): void {
  const recorded = inFlightSeq === undefined ? {} : { seq: inFlightSeq }
  writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: DEAD_PID, at: new Date().toISOString(), ...recorded }))
}

/** A trashed note as `remove` leaves it: the copy and its sidecar, both under the audit id. */
function trashedCopy(root: string, content: string, locator: string, auditId: string = AUDIT): void {
  mkdirSync(join(root, TRASH_DIR), { recursive: true })
  writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), content)
  writeFileSync(
    join(root, TRASH_DIR, `${auditId}.md.origin.json`),
    JSON.stringify({ locator, auditId, deletedAt: "2026-08-31T00:00:00Z" }),
  )
}

/** The sidecar alone, as `remove` leaves it before it writes the copy. */
function trashedSidecarOnly(root: string, locator: string, auditId: string = AUDIT): void {
  mkdirSync(join(root, TRASH_DIR), { recursive: true })
  writeFileSync(
    join(root, TRASH_DIR, `${auditId}.md.origin.json`),
    JSON.stringify({ locator, auditId, deletedAt: "2026-08-31T00:00:00Z" }),
  )
}

const createIntent = (locator: string, body: string) => ({
  intent: { kind: "create", targetLocator: locator, newContent: { type: "decision", restrictions: OPEN, body }, reason: "test", source: "test" },
  reason: "test",
  source: "test",
})

// Create. Its points: nothing written; the temporary; the WAL line; the rename. The first and the temporary-before-WAL states are
// in durability.test.ts ("C31 — crash matrix"); the state after the rename is here, with no temporary left.

describe("crash matrix: create", () => {
  it("a crash after the rename, with no temporary left, changes nothing on reopen", () => {
    const root = freshVault()
    const content = note("created")
    writeFileSync(join(root, "n.md"), content)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(content) }))
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery()).toMatchObject({ completed: [], discarded: [], conflicts: [] })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
    expect(existsSync(join(root, LOCK_FILE))).toBe(false)
  })
})

// Update. Its points are those of create, with previousHash set to the bytes the update replaces.

describe("crash matrix: update", () => {
  it("a crash after the temporary, before the WAL line, keeps the old bytes and discards the temporary", () => {
    const root = freshVault()
    const before = note("before")
    const pending = note("pending update")
    writeFileSync(join(root, "n.md"), before)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(before) }))
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().discarded).toHaveLength(1)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(before)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    expect(writer.readWal().map((entry) => entry.seq)).toEqual([1])
  })

  it("a crash after the rename, with no temporary left, keeps the new bytes", () => {
    const root = freshVault()
    const before = note("before")
    const pending = note("pending update")
    writeFileSync(join(root, "n.md"), pending)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(before) }))
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery()).toMatchObject({ completed: [], discarded: [], conflicts: [] })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
  })
})

// Move. Its points: the temporary at the destination; the WAL line, with the sequence number recorded in the lock; the rename; the
// unlink of the source. The rename-then-unlink states are in containment-review-regressions.test.ts (R4), with the realistic
// layout: no temporary left, and the lock naming the move.

describe("crash matrix: move", () => {
  it("a crash after the temporary, before the WAL line, keeps the source and discards the temporary", () => {
    const root = freshVault()
    const body = note("moved")
    writeFileSync(join(root, "from.md"), body)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "from.md", previousHash: null, newHash: sha(body) }))
    mkdirSync(join(root, "sub"), { recursive: true })
    writeFileDurable(join(root, "sub", `dest.md${TMP_SUFFIX}`), body)
    // The move recorded its number (2) in the lock, then died before appending the entry.
    plantDeadLock(root, 2)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().discarded).toHaveLength(1)
    expect(readFileSync(join(root, "from.md"), "utf8")).toBe(body)
    expect(existsSync(join(root, "sub", "dest.md"))).toBe(false)
    expect(existsSync(join(root, "sub", `dest.md${TMP_SUFFIX}`))).toBe(false)
  })

  it("a crash after the WAL line, before the rename, completes the move and removes the source", () => {
    const root = freshVault()
    const body = note("moved")
    writeFileSync(join(root, "from.md"), body)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "from.md", previousHash: null, newHash: sha(body) }))
    mkdirSync(join(root, "sub"), { recursive: true })
    writeFileDurable(join(root, "sub", `dest.md${TMP_SUFFIX}`), body)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, {
        kind: "move",
        locator: "sub/dest.md",
        previousLocator: "from.md",
        previousHash: sha(body),
        newHash: sha(body),
      }),
    )
    plantDeadLock(root, 2)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().completed).toHaveLength(1)
    expect(readFileSync(join(root, "sub", "dest.md"), "utf8")).toBe(body)
    expect(existsSync(join(root, "from.md"))).toBe(false)
    expect(existsSync(join(root, "sub", `dest.md${TMP_SUFFIX}`))).toBe(false)
  })
})

// Restore. Its points: the read of the trash, under the lock; the temporary at the destination; the WAL line, with the number in the
// lock; the rename; the unlink of the trash copy; the unlink of the sidecar.

describe("crash matrix: restore", () => {
  it("an aborted restore, after its read and before its temporary, leaves the entry trashed, and a later restore applies", async () => {
    const root = freshVault()
    const created = await new VaultMutationWriter({ root }).apply(createIntent("n.md", "kept"))
    const id = created.ref?.id as string
    const raw = readFileSync(join(root, "n.md"), "utf8")
    const deleted = await new VaultMutationWriter({ root }).apply({
      intent: { kind: "delete", targetId: id, expectedVersionHash: sha(raw), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })

    const aborted = new VaultMutationWriter({
      root,
      hooks: {
        afterRestoreRead: () => {
          throw new Error("stopped after the read")
        },
      },
    })
    await expect(aborted.restoreDeleted(deleted.auditId)).rejects.toThrow("stopped after the read")
    expect(existsSync(join(root, "n.md"))).toBe(false)

    const reopened = new VaultMutationWriter({ root })
    expect(reopened.trash().map((entry) => entry.auditId)).toEqual([deleted.auditId])
    await reopened.restoreDeleted(deleted.auditId)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(raw)
  })

  it("a crash after the temporary, before the WAL line, leaves the entry trashed and discards the temporary", () => {
    const root = freshVault()
    const content = note("trashed body")
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "delete", locator: "n.md", previousHash: sha(content), newHash: null, auditId: AUDIT }),
    )
    trashedCopy(root, content, "n.md")
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), content)
    plantDeadLock(root, 2)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().discarded).toHaveLength(1)
    expect(existsSync(join(root, "n.md"))).toBe(false)
    expect(writer.trash().map((entry) => entry.auditId)).toEqual([AUDIT])
  })

  it("a crash after the WAL line, before the rename, restores the note and lists nothing as trashed", () => {
    const root = freshVault()
    const content = note("trashed body")
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "delete", locator: "n.md", previousHash: sha(content), newHash: null, auditId: AUDIT }),
    )
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, {
        kind: "restore",
        locator: "n.md",
        previousLocator: `${TRASH_DIR}/${AUDIT}.md`,
        previousHash: null,
        newHash: sha(content),
        auditId: RESTORE_ID,
        source: "trash",
      }),
    )
    trashedCopy(root, content, "n.md")
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), content)
    plantDeadLock(root, 2)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().completed).toHaveLength(1)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
    expect(existsSync(join(root, TRASH_DIR, `${AUDIT}.md`))).toBe(false)
    expect(writer.trash()).toEqual([])
  })

  it("a crash after the rename, before the trash copy is removed, lists nothing as trashed", () => {
    const root = freshVault()
    const content = note("trashed body")
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "delete", locator: "n.md", previousHash: sha(content), newHash: null, auditId: AUDIT }),
    )
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, {
        kind: "restore",
        locator: "n.md",
        previousLocator: `${TRASH_DIR}/${AUDIT}.md`,
        previousHash: null,
        newHash: sha(content),
        auditId: RESTORE_ID,
        source: "trash",
      }),
    )
    writeFileSync(join(root, "n.md"), content)
    trashedCopy(root, content, "n.md")
    plantDeadLock(root, 2)

    const writer = new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
    expect(existsSync(join(root, TRASH_DIR, `${AUDIT}.md`))).toBe(false)
    expect(writer.trash()).toEqual([])
  })

  it("a crash after the trash copy is removed, before the sidecar, lists nothing and purges nothing", async () => {
    const root = freshVault()
    const content = note("trashed body")
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "delete", locator: "n.md", previousHash: sha(content), newHash: null, auditId: AUDIT }),
    )
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, {
        kind: "restore",
        locator: "n.md",
        previousLocator: `${TRASH_DIR}/${AUDIT}.md`,
        previousHash: null,
        newHash: sha(content),
        auditId: RESTORE_ID,
        source: "trash",
      }),
    )
    writeFileSync(join(root, "n.md"), content)
    trashedSidecarOnly(root, "n.md")
    plantDeadLock(root, 2)

    const writer = new VaultMutationWriter({ root })
    expect(writer.trash()).toEqual([])
    expect((await writer.emptyTrash({ confirm: true })).destroyed).toEqual([])
    expect(writer.readWal().filter((entry) => entry.kind === "delete")).toHaveLength(1)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
  })
})

// Delete. Its points: the sidecar; the trash copy; the WAL line; the unlink of the note. The order is fixed by `remove`: the copy and
// the record are durable before the note leaves the vault.

describe("crash matrix: delete", () => {
  it("a crash after the sidecar, before the trash copy, leaves the note in the vault and no trash entry", async () => {
    const root = freshVault()
    const content = note("still here")
    writeFileSync(join(root, "n.md"), content)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(content) }))
    trashedSidecarOnly(root, "n.md")
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
    expect(writer.trash()).toEqual([])
    expect((await writer.emptyTrash({ confirm: true })).destroyed).toEqual([])
    expect(writer.readWal().filter((entry) => entry.kind === "delete")).toEqual([])
  })

  it("a crash after the trash copy, before the WAL line, keeps the note and the copy, and refuses a restore over the note", async () => {
    // A copy with no WAL line is listed as unconfirmed, and neither a restore nor a purge takes it (ADR-092, the trash section). The
    // assertions: nothing is lost, and nothing is restored over the note.
    const root = freshVault()
    const content = note("still here")
    writeFileSync(join(root, "n.md"), content)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(content) }))
    trashedCopy(root, content, "n.md")
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
    expect(readFileSync(join(root, TRASH_DIR, `${AUDIT}.md`), "utf8")).toBe(content)
    expect(writer.trash()).toEqual([expect.objectContaining({ auditId: AUDIT, unconfirmed: "no_delete_line" })])
    await expect(writer.restoreDeleted(AUDIT)).rejects.toThrow()
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(content)
  })

  it("a crash after the WAL line, before the unlink, keeps the trash copy holding the note's bytes", () => {
    const root = freshVault()
    const content = note("deleted body")
    writeFileSync(join(root, "n.md"), content)
    appendLineDurable(join(root, WAL_FILE), walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(content) }))
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(2, { kind: "delete", locator: "n.md", previousHash: sha(content), newHash: null, auditId: AUDIT }),
    )
    trashedCopy(root, content, "n.md")
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery()).toMatchObject({ completed: [], discarded: [], conflicts: [] })
    expect(readFileSync(join(root, TRASH_DIR, `${AUDIT}.md`), "utf8")).toBe(content)
  })

  it("after the unlink, a reopen lists the entry, and a restore brings the note back", async () => {
    const root = freshVault()
    const created = await new VaultMutationWriter({ root }).apply(createIntent("n.md", "kept"))
    const id = created.ref?.id as string
    const raw = readFileSync(join(root, "n.md"), "utf8")
    const deleted = await new VaultMutationWriter({ root }).apply({
      intent: { kind: "delete", targetId: id, expectedVersionHash: sha(raw), reason: "test", source: "test" },
      reason: "test",
      source: "test",
    })
    expect(existsSync(join(root, "n.md"))).toBe(false)

    const reopened = new VaultMutationWriter({ root })
    expect(reopened.trash().map((entry) => entry.auditId)).toEqual([deleted.auditId])
    await reopened.restoreDeleted(deleted.auditId)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(raw)
  })
})
