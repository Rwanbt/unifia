/* SPDX-License-Identifier: MIT */
/**
 * Recovery and the conflict listing never act on a nested `.unifia` folder.
 *
 * A folder of that name below the vault root is not an authority. Recovery scans for temporaries and completes or discards them,
 * so a temporary inside a nested folder must be neither unlinked (its bytes are data the owner kept) nor completed into that
 * folder (a write into it). Each case here checks what the opening of the vault does, and that a note outside the folder still
 * recovers as before.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LOCK_FILE, VaultMutationWriter, WAL_FILE, pendingWriteConflicts } from "../../../src/knowledge/mutation/writer.js"
import { hasRecoveryWork } from "../../../src/knowledge/mutation/durability.js"

const ID = "0190d2c0-7b00-7000-8000-0000000000c1"

let base: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unifia-nested-recovery-"))
  vault = join(base, "vault")
  mkdirSync(join(vault, ".unifia"), { recursive: true })
  mkdirSync(join(vault, "notes", ".unifia"), { recursive: true })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function noteText(body: string): string {
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

function walLine(seq: number, fields: Record<string, unknown>): string {
  return JSON.stringify({
    seq,
    kind: "create",
    locator: "notes/x.md",
    previousHash: null,
    newHash: null,
    auditId: "00000000-0000-4000-8000-0000000000a1",
    source: "test",
    reason: "test",
    timestamp: new Date().toISOString(),
    ...fields,
  })
}

describe("an unrecorded temporary in a nested folder is not discarded on open", () => {
  it("the temporary and its bytes survive opening the vault", () => {
    const loose = join(vault, "notes", ".unifia", "loose.md.unifia-tmp")
    const bytes = noteText("kept by the owner")
    writeFileSync(loose, bytes)

    new VaultMutationWriter({ root: vault })

    expect(existsSync(loose)).toBe(true)
    expect(readFileSync(loose, "utf8")).toBe(bytes)
  })

  it("a temporary in a folder spelled in another case is kept too (the folder is the same on macOS and Windows)", () => {
    const loose = join(vault, "notes", ".UNIFIA", "loose.md.unifia-tmp")
    mkdirSync(join(vault, "notes", ".UNIFIA"), { recursive: true })
    writeFileSync(loose, noteText("kept by the owner"))

    new VaultMutationWriter({ root: vault })

    expect(existsSync(loose)).toBe(true)
  })

  it("a temporary in the root's own folder spelled in another case is kept too", () => {
    const loose = join(vault, ".UNIFIA", "loose.md.unifia-tmp")
    mkdirSync(join(vault, ".UNIFIA"), { recursive: true })
    writeFileSync(loose, noteText("kept by the owner"))

    new VaultMutationWriter({ root: vault })

    expect(existsSync(loose)).toBe(true)
  })
})

describe("a committed temporary in a nested folder is not completed into it", () => {
  it("the note is not created in the nested folder, and the WAL is unchanged", () => {
    const bytes = noteText("committed but not renamed")
    const tmp = join(vault, "notes", ".unifia", "made.md.unifia-tmp")
    writeFileSync(tmp, bytes)
    const wal = join(vault, WAL_FILE)
    const walText = `${walLine(1, { locator: "notes/.unifia/made.md", newHash: sha256(bytes) })}\n`
    writeFileSync(wal, walText)

    new VaultMutationWriter({ root: vault })

    expect(existsSync(join(vault, "notes", ".unifia", "made.md"))).toBe(false)
    expect(existsSync(tmp)).toBe(true)
    expect(readFileSync(wal, "utf8")).toBe(walText)
  })
})

describe("a nested temporary is not a pending write of the vault", () => {
  it("the conflict listing does not name a note in a nested folder", () => {
    const current = noteText("current, edited after the crash")
    const pending = noteText("pending bytes of the crashed write")
    writeFileSync(join(vault, "notes", ".unifia", "c.md"), current)
    writeFileSync(join(vault, "notes", ".unifia", "c.md.unifia-tmp"), pending)
    writeFileSync(join(vault, WAL_FILE), `${walLine(1, { locator: "notes/.unifia/c.md", newHash: sha256(pending) })}\n`)

    expect(pendingWriteConflicts(vault)).toEqual([])
  })

  it("a nested temporary alone is not work for recovery, so the vault opens without the write lock", () => {
    writeFileSync(join(vault, "notes", ".unifia", "loose.md.unifia-tmp"), noteText("kept"))

    expect(hasRecoveryWork(vault, WAL_FILE, LOCK_FILE)).toBe(false)
  })
})

describe("recovery still completes an ordinary note's temporary", () => {
  it("a committed temporary beside an ordinary note is completed, as before", () => {
    const bytes = noteText("ordinary note, committed")
    writeFileSync(join(vault, "notes", "ordinary.md.unifia-tmp"), bytes)
    writeFileSync(join(vault, WAL_FILE), `${walLine(1, { locator: "notes/ordinary.md", newHash: sha256(bytes) })}\n`)

    new VaultMutationWriter({ root: vault })

    expect(readFileSync(join(vault, "notes", "ordinary.md"), "utf8")).toBe(bytes)
    expect(existsSync(join(vault, "notes", "ordinary.md.unifia-tmp"))).toBe(false)
  })
})
