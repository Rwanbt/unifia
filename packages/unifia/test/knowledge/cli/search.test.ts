/* SPDX-License-Identifier: MIT */
/**
 * The CLI searches the real vault (card C1): the one the server and the Memory panel read.
 *
 * `makeRegistry()` declared two notes inline and `cmdSearch` used them, so
 * `search` answered `hits=2 scanned=2` for any query, including one whose
 * terms appeared nowhere. The evaluation corpus is a vault root of its own,
 * so it is composed explicitly; a project's vault is the one `openWorkspace`
 * resolves.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  openVaultRoot,
  openWorkspace,
  resolveWorkspace,
  takeWorkspace,
} from "../../../src/cli/knowledge/runtime.js"
import { VaultLocationRefused } from "../../../src/server/knowledge-authority.js"

const DEV_FIXTURES = resolve(import.meta.dir, "../../../../../tests/knowledge/eval/dev")

const SEARCH = {
  spaces: [],
  types: [],
  tags: [],
  maxCandidates: 50,
  maxPayloadBytes: 1024 * 1024,
  maxSnippetBytes: 64 * 1024,
  deadlineMs: 2_000,
}

function note(id: string, body: string, tags: string[] = []) {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-08-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-29T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    `unifia_tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    "---",
    body,
  ].join("\n")
}

async function openedVault(workspace: string) {
  const vault = await openWorkspace(workspace)
  if (vault.state !== "open") throw new Error(`expected an open vault, got ${vault.state}`)
  return vault.composed
}

describe("C1 — the CLI runtime queries the real corpus", () => {
  it("scans the fixture vault, not two synthetic notes", async () => {
    const { service } = openVaultRoot(DEV_FIXTURES)
    const { pack } = await service.search({ ...SEARCH, query: "egress" })
    expect(pack.diagnostics.candidatesScanned).toBe(11)
  })

  it("returns no hit for a term absent from the corpus", async () => {
    const { service } = openVaultRoot(DEV_FIXTURES)
    const { pack } = await service.search({
      ...SEARCH,
      query: "term-that-does-not-exist-9f3c",
    })
    expect(pack.items).toHaveLength(0)
  })

  it("gives two different queries two different answers", async () => {
    const { service } = openVaultRoot(DEV_FIXTURES)
    const a = await service.search({ ...SEARCH, query: "egress" })
    const b = await service.search({ ...SEARCH, query: "adreno" })
    const locatorsOf = (r: typeof a) => r.pack.items.map((i) => i.ref.locator).sort()
    expect(locatorsOf(a)).not.toEqual(locatorsOf(b))
    expect(locatorsOf(a).length).toBeGreaterThan(0)
    expect(locatorsOf(b).length).toBeGreaterThan(0)
  })

  it("finds the note that actually carries the term", async () => {
    const { service } = openVaultRoot(DEV_FIXTURES)
    const { pack } = await service.search({ ...SEARCH, query: "adreno" })
    expect(pack.items.map((i) => i.ref.locator)).toContain("failure-adreno-kquants.md")
  })
})

describe("C1 — workspace resolution", () => {
  let root: string
  let vaultDir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-cli-"))
    vaultDir = join(root, ".unifia", "memory")
    mkdirSync(vaultDir, { recursive: true })
    writeFileSync(join(vaultDir, "a.md"), note("1", "alpha beta", ["alpha"]))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("reports a workspace without a vault as absent, rather than inventing an empty one", async () => {
    const empty = mkdtempSync(join(tmpdir(), "unifia-empty-cli-"))
    try {
      expect(await openWorkspace(empty)).toEqual({ state: "absent", root: join(empty, ".unifia", "memory") })
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("refuses a workspace that does not exist", async () => {
    await expect(openWorkspace(join(root, "missing"))).rejects.toThrow(/does not exist/)
  })

  it("resolves a relative path to an absolute one", () => {
    expect(resolveWorkspace(".")).toBe(resolve("."))
  })

  it("accepts --workspace and a leading positional the same way", () => {
    expect(takeWorkspace(["--workspace", "/w", "x"]).workspace).toBe("/w")
    expect(takeWorkspace(["/w", "x"]).workspace).toBe("/w")
    expect(takeWorkspace(["--flag"]).workspace).toBeUndefined()
  })

  it("reads the vault the application reads, not notes loose at the workspace root or in a memory/ folder", async () => {
    writeFileSync(join(root, "loose.md"), note("3", "alpha loose"))
    mkdirSync(join(root, "memory"))
    writeFileSync(join(root, "memory", "legacy.md"), note("4", "alpha legacy"))
    const { pack } = await (await openedVault(root)).service.search({ ...SEARCH, query: "alpha" })
    const locators = pack.items.map((i) => i.ref.locator)
    expect(locators).toContain("a.md")
    expect(locators).not.toContain("loose.md")
    expect(locators).not.toContain("legacy.md")
  })

  it("does not serve a note the vault policy denies locally", async () => {
    writeFileSync(
      join(vaultDir, "secret.md"),
      note("2", "alpha secret").replace(
        "unifia_supersedes: []",
        "unifia_supersedes: []\nunifia_restrictions:\n  local_model: deny",
      ),
    )
    const { service } = await openedVault(root)
    const { pack } = await service.search({ ...SEARCH, query: "alpha" })
    expect(pack.items.map((i) => i.ref.locator)).not.toContain("secret.md")
  })

  it("refuses a default vault whose real location lies outside the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "unifia-outside-"))
    try {
      mkdirSync(join(outside, "memory"))
      rmSync(join(root, ".unifia"), { recursive: true, force: true })
      // A junction needs no elevation on Windows; elsewhere the type is ignored and a symbolic link is made.
      symlinkSync(outside, join(root, ".unifia"), "junction")
      await expect(openWorkspace(root)).rejects.toBeInstanceOf(VaultLocationRefused)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
