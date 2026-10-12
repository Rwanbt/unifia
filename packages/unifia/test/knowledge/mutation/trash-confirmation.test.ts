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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TRASH_DIR, VaultMutationWriter } from "../../../src/knowledge/mutation/writer.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const

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
