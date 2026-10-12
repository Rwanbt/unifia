/* SPDX-License-Identifier: MIT */
/**
 * The writes a caller can name a place for, or name a note for, never reach a nested `.unifia` folder.
 *
 * A move names its destination and a restore takes its destination from the trash sidecar: both are places, refused when they
 * are in a nested folder. A delete names its note by id, and a note in a nested folder is not found by id, so it cannot be removed.
 * Each case checks the refusal and that nothing in the nested folder, or outside it, changed.
 */

import { describe, it, expect } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { TRASH_DIR, VaultMutationWriter } from "../../../src/knowledge/mutation/writer.js"
import { freshVault, note } from "./conflict-fixture.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const TRASHED = "11111111-2222-4333-8444-555555555555"
const NESTED_ID = "0190d2c0-7b00-7000-8000-0000000000d1"

function intentOf(kind: string, fields: Record<string, unknown>) {
  return { intent: { kind, reason: "test", source: "test", ...fields }, reason: "test", source: "test" }
}

describe("a move into a nested folder is refused by its destination", () => {
  it("the destination is named in the refusal, and the note stays where it was", async () => {
    const root = freshVault()
    const writer = new VaultMutationWriter({ root })
    const created = await writer.apply(
      intentOf("create", { targetLocator: "n.md", newContent: { type: "decision", restrictions: OPEN, body: "moving" } }),
    )
    const before = readFileSync(join(root, "n.md"), "utf8")
    mkdirSync(join(root, "notes", ".unifia"), { recursive: true })

    const refusal = await writer
      .apply(
        intentOf("move", {
          targetId: created.ref.id,
          targetLocator: "notes/.unifia/moved.md",
          expectedVersionHash: created.ref.versionHash,
        }),
      )
      .then(() => ({ kind: "applied", message: "" }), (e: { kind?: string; message: string }) => e)

    expect(refusal.kind).toBe("mutation_refused")
    expect(refusal.message).toContain("notes/.unifia/moved.md")
    expect(refusal.message).not.toContain(root)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(before)
    expect(existsSync(join(root, "notes", ".unifia", "moved.md"))).toBe(false)
  })
})

describe("a restore into a nested folder is refused by the destination in the trash sidecar", () => {
  it("the destination is named in the refusal, and the trash entry is kept", async () => {
    // restoreDeleted is async: the refusal arrives as a rejection, which the test awaits below.
    const root = freshVault()
    const trash = join(root, TRASH_DIR)
    mkdirSync(trash, { recursive: true })
    const bytes = note("restored body", NESTED_ID)
    writeFileSync(join(trash, `${TRASHED}.md`), bytes)
    writeFileSync(
      join(trash, `${TRASHED}.md.origin.json`),
      JSON.stringify({ locator: "notes/.unifia/back.md", auditId: TRASHED, deletedAt: "2026-08-31T00:00:00Z" }),
    )
    const writer = new VaultMutationWriter({ root })

    const refusal = await writer.restoreDeleted(TRASHED).then(
      () => ({ kind: "applied", message: "" }),
      (e: { kind?: string; message: string }) => e,
    )

    expect(refusal.kind).toBe("mutation_refused")
    expect(refusal.message).toContain("notes/.unifia/back.md")
    expect(refusal.message).not.toContain(root)
    expect(existsSync(join(root, "notes", ".unifia", "back.md"))).toBe(false)
    expect(existsSync(join(trash, `${TRASHED}.md`))).toBe(true)
  })
})

describe("a note in a nested folder cannot be deleted by id", () => {
  it("the delete finds no note, and the nested file is untouched", async () => {
    const root = freshVault()
    mkdirSync(join(root, "notes", ".unifia"), { recursive: true })
    const nestedFile = join(root, "notes", ".unifia", "kept.md")
    const bytes = note("kept by the owner", NESTED_ID)
    writeFileSync(nestedFile, bytes)
    const writer = new VaultMutationWriter({ root })

    const refusal = await writer
      .apply(intentOf("delete", { targetId: NESTED_ID, expectedVersionHash: "0".repeat(64) }))
      .then(() => ({ kind: "applied", message: "" }), (e: { kind?: string; message: string }) => e)

    expect(refusal.kind).toBe("source_inconsistent")
    expect(refusal.message).not.toContain(root)
    expect(readFileSync(nestedFile, "utf8")).toBe(bytes)
  })
})
