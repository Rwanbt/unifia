/* SPDX-License-Identifier: MIT */
/**
 * Trash entries the write-ahead log does not confirm (ADR-092, the M entry and the open item on trashed copies with no WAL line).
 *
 * `remove` writes the trash sidecar, then the copy, then the WAL line that records the delete, and only then unlinks the note. A copy
 * with no delete line is therefore a delete that stopped in the middle, or a copy the log does not vouch for. In that state the note is
 * still in the vault, and the copy is not a trash entry the log confirms: it is neither destroyed nor restored on the strength of its
 * file name.
 */

import { afterEach, describe, expect, it } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TMP_SUFFIX } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE, TRASH_DIR, VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"
import { formatRetention, retentionReport } from "../../../src/knowledge/admin/retention.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex")

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A vault root with its own folder, in a fresh directory the test removes afterwards. */
function freshVault(): string {
  const base = mkdtempSync(join(tmpdir(), "unifia-trash-confirm-"))
  made.push(base)
  const root = join(base, "vault")
  mkdirSync(join(root, ".unifia"), { recursive: true })
  return root
}

const createIntent = (locator: string, body: string) => ({
  intent: {
    kind: "create",
    targetLocator: locator,
    newContent: { type: "decision", restrictions: OPEN, body },
    reason: "test",
    source: "test",
  },
  reason: "test",
  source: "test",
})

/** A trash copy and its sidecar, as `remove` writes them, with no WAL line for the delete. Returns the audit id. */
function copyWithoutDeleteLine(root: string, content: string, locator: string): string {
  const auditId = randomUUID()
  mkdirSync(join(root, TRASH_DIR), { recursive: true })
  writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), content)
  writeFileSync(
    join(root, TRASH_DIR, `${auditId}.md.origin.json`),
    JSON.stringify({ locator, auditId, deletedAt: "2026-10-01T00:00:00.000Z" }),
  )
  return auditId
}

/** A real delete: the note is created, then deleted through the writer. Returns the audit id of the delete. */
async function seedAndDelete(writer: VaultMutationWriter, root: string, locator: string, body: string): Promise<string> {
  const created = await writer.apply(createIntent(locator, body))
  const raw = readFileSync(join(root, locator), "utf8")
  const deleted = await writer.apply({
    intent: {
      kind: "delete",
      targetId: created.ref?.id as string,
      expectedVersionHash: sha(raw),
      reason: "test",
      source: "test",
    },
    reason: "test",
    source: "test",
  })
  return deleted.auditId
}

/** The erasure lines in the WAL: the lines `emptyTrash` appends for a purged copy. Read from the file, so no writer is opened. */
function erasureLines(root: string): string[] {
  const path = join(root, WAL_FILE)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.includes('"auditId":"purge-'))
}

describe("a purge refuses an entry whose locator is live", () => {
  it("does not erase a note written again at the locator, and the refusal names no path", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    await writer.apply(createIntent("n.md", "written since"))
    const live = readFileSync(join(root, "n.md"), "utf8")

    const result = await writer.emptyTrash({ confirm: true })

    expect(result.destroyed).toEqual([])
    expect(result.refused).toHaveLength(1)
    expect(result.refused[0]).toMatchObject({ code: "locator_live", entry: { auditId, locator: "n.md" } })
    expect(result.refused[0]?.message).toContain("n.md")
    expect(result.refused[0]?.message).not.toContain(root)
    expect(existsSync(join(root, TRASH_DIR, `${auditId}.md`))).toBe(true)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(live)
    expect(erasureLines(root)).toEqual([])
  })

  it("refuses while a pending write holds the locator", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    writeFileSync(join(root, `n.md${TMP_SUFFIX}`), "pending")

    const result = await writer.emptyTrash({ confirm: true })

    expect(result.destroyed).toEqual([])
    expect(result.refused.map((refusal) => refusal.code)).toEqual(["locator_live"])
    expect(existsSync(join(root, TRASH_DIR, `${auditId}.md`))).toBe(true)
    expect(erasureLines(root)).toEqual([])
  })

  it("purges the other entries and reports the refused one with its reason", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const kept = await seedAndDelete(writer, root, "a.md", "a")
    const purged = await seedAndDelete(writer, root, "b.md", "b")
    await writer.apply(createIntent("a.md", "a again"))

    const result = await writer.emptyTrash({ confirm: true })

    expect(result.destroyed.map((entry) => entry.auditId)).toEqual([purged])
    expect(result.refused.map((refusal) => [refusal.entry.auditId, refusal.code])).toEqual([[kept, "locator_live"]])
    expect(erasureLines(root).map((line) => JSON.parse(line).locator)).toEqual(["b.md"])
  })

  it("appends the erasure only after the copy is gone", async () => {
    const root = freshVault()
    const seen: Array<{ copyGone: boolean; erasures: number }> = []
    const writer = new VaultMutationWriter({
      root,
      hooks: {
        afterPurgeUnlink: (auditId) => {
          seen.push({ copyGone: !existsSync(join(root, TRASH_DIR, `${auditId}.md`)), erasures: erasureLines(root).length })
        },
      },
    })
    await seedAndDelete(writer, root, "n.md", "gone")

    await writer.emptyTrash({ confirm: true })

    expect(seen).toEqual([{ copyGone: true, erasures: 0 }])
    expect(erasureLines(root)).toHaveLength(1)
  })
})

describe("a purge of a trash copy the log does not confirm", () => {
  it("destroys nothing and writes no erasure when the note is still live at the copy's locator", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    await writer.apply(createIntent("n.md", "still live"))
    const raw = readFileSync(join(root, "n.md"), "utf8")
    const auditId = copyWithoutDeleteLine(root, raw, "n.md")

    const result = await writer.emptyTrash({ confirm: true })

    expect(result.destroyed).toEqual([])
    expect(readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")).toBe(raw)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(raw)
    expect(writer.readWal().filter((entry) => entry.auditId.startsWith("purge-"))).toEqual([])
  })
})

describe("the listing reports a copy the log does not confirm", () => {
  it("lists a copy with no delete line as unconfirmed, and a confirmed entry keeps its three fields", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const confirmed = await seedAndDelete(writer, root, "a.md", "a")
    const unlogged = copyWithoutDeleteLine(root, "unlogged body", "b.md")

    const byId = new Map(writer.trash().map((entry) => [entry.auditId, entry]))

    expect(Object.keys(byId.get(confirmed) ?? {}).sort()).toEqual(["auditId", "deletedAt", "locator"])
    expect(byId.get(unlogged)).toMatchObject({ locator: "b.md", unconfirmed: "no_delete_line" })
  })

  it("lists a copy whose bytes differ from the logged delete as not the logged copy", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), "altered after the delete\n")

    expect(writer.trash()).toEqual([expect.objectContaining({ auditId, unconfirmed: "not_the_logged_copy" })])
  })

  it("lists a copy that a restore has taken from the trash as restored in the log", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    const copy = readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")
    const sidecar = readFileSync(join(root, TRASH_DIR, `${auditId}.md.origin.json`), "utf8")
    await writer.restoreDeleted(auditId)
    // The restore consumed the copy; a crash that left it behind is what this state is.
    writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), copy)
    writeFileSync(join(root, TRASH_DIR, `${auditId}.md.origin.json`), sidecar)

    expect(writer.trash()).toEqual([expect.objectContaining({ auditId, unconfirmed: "restored_in_log" })])
  })

  it("keeps an unconfirmed entry out of the retention report's purgeable list, and reports it", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    await seedAndDelete(writer, root, "a.md", "a")
    copyWithoutDeleteLine(root, "unlogged body", "b.md")
    const later = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000)

    const report = await retentionReport({ vaultRoot: root, now: later, trash: writer.trash() })

    expect(report.purgeableTrash.map((entry) => entry.locator)).toEqual(["a.md"])
    expect(report.unconfirmedTrash.map((entry) => entry.locator)).toEqual(["b.md"])
    expect(formatRetention(report)).toContain("b.md")
  })
})

describe("a restore takes only a copy the log confirms", () => {
  it("refuses a copy with no delete line, and leaves the destination absent and the copy kept", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = copyWithoutDeleteLine(root, "unlogged body", "n.md")

    await expect(writer.restoreDeleted(auditId)).rejects.toThrow(/no WAL line records the delete of n\.md/)
    expect(existsSync(join(root, "n.md"))).toBe(false)
    expect(readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")).toBe("unlogged body")
  })

  it("refuses a copy whose bytes the delete line does not record", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    const altered = "altered after the delete\n"
    writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), altered)

    await expect(writer.restoreDeleted(auditId)).rejects.toMatchObject({ kind: "mutation_refused" })
    expect(existsSync(join(root, "n.md"))).toBe(false)
    expect(readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")).toBe(altered)
  })

  it("completes over a destination that already holds the copy's own bytes, and consumes the entry", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    const copy = readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")
    writeFileSync(join(root, "n.md"), copy)

    const restored = await writer.restoreDeleted(auditId)

    expect(restored.applied).toBe(true)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(copy)
    expect(existsSync(join(root, TRASH_DIR, `${auditId}.md`))).toBe(false)
    expect(writer.trash()).toEqual([])
  })

  it("refuses a destination that holds other bytes, and keeps both the note and the copy", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    const copy = readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")
    writeFileSync(join(root, "n.md"), "written since\n")

    await expect(writer.restoreDeleted(auditId)).rejects.toMatchObject({ kind: "cas_mismatch" })
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe("written since\n")
    expect(readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")).toBe(copy)
  })

  it("restores the note once when its delete is logged but its unlink did not run", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    await writer.apply(createIntent("n.md", "kept"))
    const raw = readFileSync(join(root, "n.md"), "utf8")
    const auditId = randomUUID()
    // The state after the WAL line and before the unlink: the note, its copy and its sidecar are all there, and the log records the delete.
    mkdirSync(join(root, TRASH_DIR), { recursive: true })
    writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), raw)
    writeFileSync(
      join(root, TRASH_DIR, `${auditId}.md.origin.json`),
      JSON.stringify({ locator: "n.md", auditId, deletedAt: "2026-10-01T00:00:00.000Z" }),
    )
    appendFileSync(
      join(root, WAL_FILE),
      `${JSON.stringify({ seq: 2, kind: "delete", locator: "n.md", previousHash: sha(raw), newHash: null, auditId, source: "test", reason: "test", timestamp: "2026-10-01T00:00:00.000Z" })}\n`,
    )
    const reopened = new VaultMutationWriter({ root })
    expect(reopened.trash().map((entry) => entry.auditId)).toEqual([auditId])

    const restored = await reopened.restoreDeleted(auditId)

    expect(restored.applied).toBe(true)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(raw)
    expect(reopened.trash()).toEqual([])
  })

  it("a crash in a restore over identical bytes, after its WAL line, leaves one note and no trash copy on reopen", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    await writer.apply(createIntent("n.md", "kept"))
    const raw = readFileSync(join(root, "n.md"), "utf8")
    const auditId = randomUUID()
    const restoreSeq = 3
    mkdirSync(join(root, TRASH_DIR), { recursive: true })
    writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), raw)
    writeFileSync(
      join(root, TRASH_DIR, `${auditId}.md.origin.json`),
      JSON.stringify({ locator: "n.md", auditId, deletedAt: "2026-10-01T00:00:00.000Z" }),
    )
    const line = (seq: number, fields: Record<string, unknown>) =>
      `${JSON.stringify({ seq, source: "test", reason: "test", timestamp: "2026-10-01T00:00:00.000Z", ...fields })}\n`
    appendFileSync(
      join(root, WAL_FILE),
      line(2, { kind: "delete", locator: "n.md", previousHash: sha(raw), newHash: null, auditId }) +
        line(restoreSeq, {
          kind: "restore",
          locator: "n.md",
          previousLocator: `${TRASH_DIR}/${auditId}.md`,
          previousHash: null,
          newHash: sha(raw),
          auditId: randomUUID(),
        }),
    )
    // The restore's temporary is on disk beside the identical note, and the dead writer's lock names the restore.
    writeFileSync(join(root, `n.md${TMP_SUFFIX}`), raw)
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: 2_147_483_646, at: new Date().toISOString(), seq: restoreSeq }))

    const reopened = new VaultMutationWriter({ root })

    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(raw)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    expect(existsSync(join(root, TRASH_DIR, `${auditId}.md`))).toBe(false)
    expect(reopened.trash()).toEqual([])
  })
})

describe("a purge refuses a copy the log does not confirm", () => {
  it("refuses a copy with no delete line when its note is gone too, and keeps the copy", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    await writer.apply(createIntent("n.md", "removed by hand"))
    const raw = readFileSync(join(root, "n.md"), "utf8")
    rmSync(join(root, "n.md"))
    const auditId = copyWithoutDeleteLine(root, raw, "n.md")

    const result = await writer.emptyTrash({ confirm: true })

    expect(result.destroyed).toEqual([])
    expect(result.refused.map((refusal) => [refusal.entry.auditId, refusal.code])).toEqual([[auditId, "unconfirmed"]])
    expect(result.refused[0]?.message).toContain("n.md")
    expect(result.refused[0]?.message).not.toContain(root)
    expect(readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")).toBe(raw)
    expect(erasureLines(root)).toEqual([])
  })

  it("refuses a copy whose bytes the delete line does not record, and keeps the copy", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const auditId = await seedAndDelete(writer, root, "n.md", "trashed")
    const altered = "altered after the delete\n"
    writeFileSync(join(root, TRASH_DIR, `${auditId}.md`), altered)

    const result = await writer.emptyTrash({ confirm: true })

    expect(result.destroyed).toEqual([])
    expect(result.refused.map((refusal) => refusal.code)).toEqual(["unconfirmed"])
    expect(readFileSync(join(root, TRASH_DIR, `${auditId}.md`), "utf8")).toBe(altered)
    expect(erasureLines(root)).toEqual([])
  })
})
