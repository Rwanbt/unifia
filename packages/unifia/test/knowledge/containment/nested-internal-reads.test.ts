/* SPDX-License-Identifier: MIT */
/**
 * A note in the vault's own folder, or in a nested folder of that name, is not read by locator.
 *
 * The listing and the search already skip such folders. An explicit read by locator used to return the note's content anyway: the
 * reader checked that a locator stayed inside the vault, not whether its place was a folder of the vault's own bookkeeping. These
 * cases read every route a caller has (the source's read, the service's get, readOwned and versionHash), by a plain locator, a
 * spelling of the folder's name, a file link and a folder link. Each answers as it does for a note that is not there: absent.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"
import { openMemory, resetMemoryCache } from "../../../src/knowledge/app/memory.js"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const PLANTED_ID = "0190d2c0-7b00-7000-8000-0000000000a1"
const CONTROL_ID = "0190d2c0-7b00-7000-8000-0000000000a2"
const SPACE = { kind: "personal", id: "p", label: "Personal" } as const

let worktree: string
let vault: string

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "unifia-nested-reads-"))
  vault = join(worktree, ".unifia", "memory")
  mkdirSync(join(vault, "notes", ".unifia"), { recursive: true })
  mkdirSync(join(vault, ".unifia"), { recursive: true })
  writeFileSync(join(vault, "notes", ".unifia", "planted.md"), noteText(PLANTED_ID, "PLANTEDWORD nested body"))
  writeFileSync(join(vault, "notes", "control.md"), noteText(CONTROL_ID, "CONTROLWORD visible body"))
  writeFileSync(join(vault, ".unifia", "secret.md"), noteText(PLANTED_ID, "SECRETWORD canonical body"))
})

afterEach(() => {
  resetMemoryCache()
  rmSync(worktree, { recursive: true, force: true })
})

function noteText(id: string, body: string): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${id}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-08-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-01T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "unifia_restrictions:",
    "  remote_model: allow",
    "  local_model: allow",
    "---",
    body,
  ].join("\n")
}

function source(): VaultSource {
  return new VaultSource({ root: vault, space: SPACE })
}

function service() {
  const composed = openMemory({ worktree, providerId: "local-llm", destinationKind: "local" })
  if (composed === undefined) throw new Error("the vault did not open")
  return composed.service
}

describe("a note in a nested folder of the vault's own name is not read by locator", () => {
  it("the source returns nothing for a locator into the nested folder", async () => {
    expect(await source().read("notes/.unifia/planted.md" as KnowledgeLocator)).toBeNull()
  })

  it("the source returns nothing for the same folder spelled in another case", async () => {
    mkdirSync(join(vault, "notes", ".UNIFIA"), { recursive: true })
    writeFileSync(join(vault, "notes", ".UNIFIA", "other.md"), noteText(CONTROL_ID, "OTHERWORD body"))
    expect(await source().read("notes/.UNIFIA/other.md" as KnowledgeLocator)).toBeNull()
  })

  it("the service returns nothing for a locator into the nested folder, by get, readOwned or versionHash", async () => {
    const svc = service()
    const locator = "notes/.unifia/planted.md" as KnowledgeLocator
    expect(await svc.get(undefined, locator)).toBeNull()
    expect(await svc.readOwned(undefined, locator)).toBeNull()
    expect(await svc.versionHash(undefined, locator)).toBeNull()
  })

  it("a file link to a note in the nested folder is not read through the link", async () => {
    symlinkSync(join(vault, "notes", ".unifia", "planted.md"), join(vault, "notes", "flink.md"))
    expect(await source().read("notes/flink.md" as KnowledgeLocator)).toBeNull()
  })

  it("a folder link into the nested folder is not read through the link", async () => {
    symlinkSync(join(vault, "notes", ".unifia"), join(vault, "alias"))
    expect(await source().read("alias/planted.md" as KnowledgeLocator)).toBeNull()
  })
})

describe("the vault's own folder is not read by locator either", () => {
  it("the source returns nothing for a locator into the canonical folder", async () => {
    expect(await source().read(".unifia/secret.md" as KnowledgeLocator)).toBeNull()
  })

  it("the service returns nothing for the canonical folder by locator", async () => {
    expect(await service().get(undefined, ".unifia/secret.md" as KnowledgeLocator)).toBeNull()
  })
})

describe("the ordinary notes are still read by locator", () => {
  it("a note outside any such folder is read by the source and by the service", async () => {
    const doc = await source().read("notes/control.md" as KnowledgeLocator)
    expect(doc?.note.frontmatter.unifia_id).toBe(CONTROL_ID)
    expect(await service().get(undefined, "notes/control.md" as KnowledgeLocator)).not.toBeNull()
  })
})
