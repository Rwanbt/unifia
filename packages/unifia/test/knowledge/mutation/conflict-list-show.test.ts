/* SPDX-License-Identifier: MIT */
/**
 * `unifia knowledge conflicts list` and `show` (read-only), on a conflict produced by a crash.
 *
 * Requirement 1: list every unresolved conflict with its note locator, operation and WAL sequence number.
 * Requirement 2: show the operation and the note, and both versions with hash, size and a bounded preview.
 * Requirement 6 (part): the conflict record is created when recovery leaves a conflict, and nothing else changes.
 */

import { describe, it, expect } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { listConflicts, showConflict } from "../../../src/knowledge/admin/conflicts.js"
import { TMP_SUFFIX, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { WAL_FILE, pendingWriteConflicts } from "../../../src/knowledge/mutation/writer.js"
import { CONFLICTS_DIR } from "../../../src/knowledge/mutation/conflict-record.js"
import {
  crashedUpdate,
  freshVault,
  note,
  openWriter,
  refusalOf,
  sha,
  walLine,
} from "./conflict-fixture.js"

describe("list: every unresolved conflict, with its note, operation and sequence number", () => {
  it("lists the conflict left by a crashed update", () => {
    const { root } = crashedUpdate()
    openWriter(root)
    const rows = listConflicts(root)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ locator: "n.md", operation: "update", seq: 2, currentState: "file" })
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{16}$/)
  })

  it("lists nothing for a vault without conflicts", () => {
    expect(listConflicts(freshVault())).toEqual([])
  })

  it("names the operation of the pending write, so a create that met a user's file is a create", () => {
    const root = freshVault()
    const pending = note("first write")
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(pending) }),
    )
    writeFileSync(join(root, "n.md"), note("written by the user before the create landed"))
    openWriter(root)
    expect(listConflicts(root)).toMatchObject([{ locator: "n.md", operation: "create", seq: 1 }])
  })
})

describe("show: the operation, the note, and both versions", () => {
  it("gives the pending and the current version with hash, size and a bounded preview", () => {
    const { root, pending, edit } = crashedUpdate()
    openWriter(root)
    const id = listConflicts(root)[0]?.id as string
    const detail = showConflict(root, id)
    expect(detail).toMatchObject({
      id,
      locator: "n.md",
      operation: "update",
      seq: 2,
      auditId: "audit-2",
      pending: { hash: sha(pending), size: Buffer.byteLength(pending) },
      current: { state: "file", hash: sha(edit), size: Buffer.byteLength(edit) },
      later: null,
      openApply: false,
      latestPlan: null,
    })
    expect(detail.pending.preview).toContain("committed write, rename failed")
    expect(detail.current.preview).toContain("USER EDIT after the crash")
    expect(detail.pending.preview.length).toBeLessThanOrEqual(256)
    expect(detail.current.preview?.length ?? 0).toBeLessThanOrEqual(256)
  })

  it("reports the newest entry for the note when a later delete follows the pending write", () => {
    const { root, edit } = crashedUpdate()
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(3, { kind: "delete", locator: "n.md", previousHash: sha(edit), newHash: null }),
    )
    openWriter(root)
    const id = listConflicts(root)[0]?.id as string
    expect(showConflict(root, id).later).toEqual({ seq: 3, kind: "delete" })
  })

  it("refuses an id that is not a conflict id, before any path is used", () => {
    const { root } = crashedUpdate()
    openWriter(root)
    const refused = refusalOf(() => showConflict(root, "../../wal"))
    expect(refused.kind).toBe("mutation_refused")
    expect(refused.message).toMatch(/not a conflict id/)
  })

  it("refuses an id with no unresolved conflict", () => {
    const { root } = crashedUpdate()
    openWriter(root)
    expect(refusalOf(() => showConflict(root, "0123456789abcdef")).message).toMatch(/no unresolved conflict/)
  })
})

describe("list and show change nothing, and the record is created on open", () => {
  it("the temporary, the note and the log are as the crash left them after list and show", () => {
    const { root } = crashedUpdate()
    openWriter(root)
    const before = ["n.md", `n.md${TMP_SUFFIX}`, WAL_FILE].map((p) => readFileSync(join(root, p)))
    const id = listConflicts(root)[0]?.id as string
    showConflict(root, id)
    listConflicts(root)
    const after = ["n.md", `n.md${TMP_SUFFIX}`, WAL_FILE].map((p) => readFileSync(join(root, p)))
    expect(after).toEqual(before)
  })

  it("the record is created by the open that recovery left the conflict in", () => {
    const { root } = crashedUpdate()
    expect(existsSync(join(root, CONFLICTS_DIR))).toBe(false)
    openWriter(root)
    const id = listConflicts(root)[0]?.id as string
    expect(readdirSync(join(root, CONFLICTS_DIR))).toContain(id)
    const record = JSON.parse(readFileSync(join(root, CONFLICTS_DIR, id, "record.json"), "utf8"))
    expect(record).toMatchObject({ id, locator: "n.md", operation: "update", seq: 2 })
  })

  it("the record and its folder are owner-only where the platform has permissions", () => {
    if (process.platform === "win32") return
    const { root } = crashedUpdate()
    openWriter(root)
    const id = listConflicts(root)[0]?.id as string
    expect(statSync(join(root, CONFLICTS_DIR)).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, CONFLICTS_DIR, id)).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, CONFLICTS_DIR, id, "record.json")).mode & 0o777).toBe(0o600)
  })

  it("a second open of the same crash finds the same conflict id", () => {
    const { root } = crashedUpdate()
    openWriter(root)
    const first = listConflicts(root)[0]?.id
    openWriter(root)
    expect(listConflicts(root)[0]?.id).toBe(first)
    expect(readdirSync(join(root, CONFLICTS_DIR))).toEqual([first])
  })
})

describe("the conflict is found through the same judgement the doctor uses", () => {
  it("the list and the doctor's pending conflicts name the same note", () => {
    const { root } = crashedUpdate()
    openWriter(root)
    expect(listConflicts(root).map((c) => c.locator)).toEqual(pendingWriteConflicts(root))
  })
})
