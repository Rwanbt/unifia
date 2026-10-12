/* SPDX-License-Identifier: MIT */
/**
 * The listing names each nested `.unifia` folder it skipped, and the outputs keep their shape.
 *
 * A nested folder is neither listed nor read, which is right, but the walk used to drop it without a trace: an owner whose
 * notes sat in such a folder had no way to see that they were there. The scan now records each nested folder, by its vault
 * path, and the service reports it beside the other files the vault does not govern, with the reason it has. The list itself
 * keeps its shape: no entry is added to it, and no nested folder is taken for a note that failed to parse.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openMemory, resetMemoryCache } from "../../../src/knowledge/app/memory.js"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const SPACE = { kind: "personal", id: "p", label: "Personal" } as const
const ID = "0190d2c0-7b00-7000-8000-0000000000b1"

let worktree: string
let vault: string

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "unifia-nested-report-"))
  vault = join(worktree, ".unifia", "memory")
  mkdirSync(join(vault, ".unifia"), { recursive: true })
  mkdirSync(join(vault, "notes", ".unifia"), { recursive: true })
  mkdirSync(join(vault, "other", "deeper", ".unifia"), { recursive: true })
  writeFileSync(join(vault, "notes", ".unifia", "planted.md"), governed("nested body"))
  writeFileSync(join(vault, "other", "deeper", ".unifia", "also.md"), governed("deeper body"))
  writeFileSync(join(vault, "notes", "control.md"), governed("visible body"))
  writeFileSync(join(vault, "notes", "hand-written.md"), "# Written by hand\n\nno governance here")
})

afterEach(() => {
  resetMemoryCache()
  rmSync(worktree, { recursive: true, force: true })
})

function governed(body: string): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${ID}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-08-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-01T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    body,
  ].join("\n")
}

describe("the scan names each nested folder it did not read", () => {
  it("records every nested folder, by its vault path, and only those", async () => {
    const source = new VaultSource({ root: vault, space: SPACE })
    await source.list({})

    expect(source.lastScan.nestedFolders).toEqual(["notes/.unifia", "other/deeper/.unifia"])
  })

  it("does not record the vault's own folder at the root", async () => {
    const source = new VaultSource({ root: vault, space: SPACE })
    await source.list({})

    expect(source.lastScan.nestedFolders).not.toContain(".unifia")
  })

  it("names a folder reached through a link once, by the place it really is", async () => {
    symlinkSync(join(vault, "notes", ".unifia"), join(vault, "alias"))
    const source = new VaultSource({ root: vault, space: SPACE })
    await source.list({})

    expect(source.lastScan.nestedFolders.filter((p) => p === "notes/.unifia")).toHaveLength(1)
  })

  it("starts each scan from a clean report", async () => {
    const source = new VaultSource({ root: vault, space: SPACE })
    await source.list({})
    rmSync(join(vault, "other"), { recursive: true, force: true })
    await source.list({})

    expect(source.lastScan.nestedFolders).toEqual(["notes/.unifia"])
  })

  it("does not put a nested folder among the scan errors, which are for notes that failed to parse", async () => {
    const source = new VaultSource({ root: vault, space: SPACE })
    await source.list({})

    expect(source.lastScanErrors.map((e) => e.locator)).toEqual(["notes/hand-written.md"])
  })
})

describe("the list and the search keep their shape, and do not return a nested note", () => {
  it("the list returns only the vault's own notes, with the same fields as before", async () => {
    const source = new VaultSource({ root: vault, space: SPACE })
    const notes = await source.list({})

    expect(notes.map((n) => n.ref.locator)).toEqual(["notes/control.md"])
    expect(Object.keys(notes[0] ?? {}).sort()).toEqual(["lifecycle", "ref", "type", "updatedAt"])
  })
})

describe("the service reports the nested folders beside the files it does not govern", () => {
  it("unmanagedFiles names each nested folder with its reason, and keeps the hand-written note's reason", async () => {
    const composed = openMemory({ worktree, providerId: "local-llm", destinationKind: "local" })
    if (composed === undefined) throw new Error("the vault did not open")
    await composed.service.listVisible()

    const unmanaged = await composed.service.unmanagedFiles()

    expect(unmanaged).toContainEqual({ locator: "notes/.unifia", reason: "nested vault folder" })
    expect(unmanaged).toContainEqual({ locator: "other/deeper/.unifia", reason: "nested vault folder" })
    expect(unmanaged).toContainEqual({ locator: "notes/hand-written.md", reason: "not a governed note" })
  })

  it("the report carries no part of a nested note's content", async () => {
    const composed = openMemory({ worktree, providerId: "local-llm", destinationKind: "local" })
    if (composed === undefined) throw new Error("the vault did not open")
    await composed.service.listVisible()

    expect(JSON.stringify(await composed.service.unmanagedFiles())).not.toContain("nested body")
  })
})
