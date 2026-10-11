/* SPDX-License-Identifier: MIT */
/**
 * The default vault stays inside its project, whichever surface opens it.
 *
 * A `.unifia` committed as a link, or left as one, pointed the vault outside the project: the first create wrote
 * the policy and the notes there. `openMemory` is the one place every surface passes through, so the boundary is
 * tested there. The refusal is decided before anything is read or created, and it names no path.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hasConfiguredDirectory, openMemory, resetMemoryCache } from "../../../src/knowledge/app/memory.js"
import { VaultLocationRefused } from "../../../src/knowledge/app/project-boundary.js"
import { composeKnowledgeService } from "../../../src/knowledge/facade/compose.js"

let base: string
let worktree: string
let outside: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unifia-boundary-"))
  worktree = join(base, "project")
  outside = join(base, "outside")
  mkdirSync(worktree)
  mkdirSync(outside)
  resetMemoryCache()
})

afterEach(() => {
  resetMemoryCache()
  rmSync(base, { recursive: true, force: true })
})

/** The owner's writable composition, as the Memory panel opens it. */
function open(extra: { create?: boolean; writable?: boolean; settings?: { enabled?: boolean; directory?: string } } = {}) {
  return openMemory({
    worktree,
    providerId: "unifia-ui",
    destinationKind: "local",
    audience: "owner",
    writable: true,
    create: true,
    ...extra,
  })
}

describe("the default vault stays inside its project", () => {
  it("a default vault inside the project is created where it always was", () => {
    expect(open()).toBeDefined()
    expect(existsSync(join(worktree, ".unifia", "memory"))).toBe(true)
  })

  it("a first create through a link to a folder outside the project is refused, and writes nothing there", () => {
    symlinkSync(outside, join(worktree, ".unifia"))
    expect(() => open()).toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })

  it("a first create through a dangling link is refused, and its target is not made", () => {
    symlinkSync(join(outside, "missing"), join(worktree, ".unifia"))
    expect(() => open()).toThrow(VaultLocationRefused)
    expect(existsSync(join(outside, "missing"))).toBe(false)
  })

  it("a vault that is itself a link outside the project is refused", () => {
    mkdirSync(join(worktree, ".unifia"))
    symlinkSync(outside, join(worktree, ".unifia", "memory"))
    expect(() => open()).toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })

  it("reading an existing vault through an outside link is refused too", () => {
    mkdirSync(join(outside, "memory"))
    symlinkSync(outside, join(worktree, ".unifia"))
    expect(() => open({ create: false, writable: false })).toThrow(VaultLocationRefused)
  })

  it("a blank location is no location, so the default vault is checked as well", () => {
    symlinkSync(outside, join(worktree, ".unifia"))
    expect(() => open({ settings: { directory: "   " } })).toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })

  it("the refusal names no path", () => {
    symlinkSync(outside, join(worktree, ".unifia"))
    let caught: unknown
    try {
      open()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(VaultLocationRefused)
    const message = (caught as Error).message
    expect(message).not.toContain(outside)
    expect(message).not.toContain(base)
  })

  it("a link that stays inside the project is accepted", () => {
    mkdirSync(join(worktree, "store"))
    symlinkSync(join(worktree, "store"), join(worktree, ".unifia"))
    expect(open()).toBeDefined()
    expect(existsSync(join(worktree, "store", "memory"))).toBe(true)
  })

  it("a blank location is no location on every surface's check, as the root resolves it", () => {
    expect(hasConfiguredDirectory({ directory: "   " })).toBe(false)
    expect(hasConfiguredDirectory({ directory: "" })).toBe(false)
    expect(hasConfiguredDirectory({ directory: "store" })).toBe(true)
  })

  it("a configured location is the owner's own choice, and is not checked here", () => {
    const configured = join(outside, "vault")
    expect(open({ settings: { directory: configured } })).toBeDefined()
    expect(existsSync(configured)).toBe(true)
  })

  it("with memory disabled nothing is opened, so the link is not followed", () => {
    symlinkSync(outside, join(worktree, ".unifia"))
    expect(open({ settings: { enabled: false } })).toBeUndefined()
    expect(readdirSync(outside)).toEqual([])
  })

  it.skipIf(process.platform !== "win32")("a junction to a folder outside the project is refused", () => {
    symlinkSync(outside, join(worktree, ".unifia"), "junction")
    expect(() => open()).toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })
})

describe("a link inside the vault cannot lead a write outside it", () => {
  const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const

  it("a create under a folder that links outside the vault is refused, and nothing is written there", async () => {
    const composed = open()
    if (composed === undefined) throw new Error("the vault should open")
    symlinkSync(outside, join(worktree, ".unifia", "memory", "evil"))
    let refused = false
    try {
      const result = await composed.service.propose({
        intent: {
          kind: "create",
          targetLocator: "evil/new.md",
          newContent: { type: "decision", restrictions: OPEN, body: "body" },
          reason: "boundary",
          source: "test",
        } as never,
        reason: "boundary",
        source: "test",
      })
      refused = result.applied !== true
    } catch {
      refused = true
    }
    expect(refused).toBe(true)
    expect(readdirSync(outside)).toEqual([])
  })

  it("a create onto a dangling link inside the vault is refused, and the link is kept", async () => {
    const composed = open()
    if (composed === undefined) throw new Error("the vault should open")
    const notes = join(worktree, ".unifia", "memory", "notes")
    mkdirSync(notes)
    const link = join(notes, "new.md")
    symlinkSync(join(outside, "target.md"), link)
    await expect(
      composed.service.propose({
        intent: {
          kind: "create",
          targetLocator: "notes/new.md",
          newContent: { type: "decision", restrictions: OPEN, body: "body" },
          reason: "boundary",
          source: "test",
        } as never,
        reason: "boundary",
        source: "test",
      }),
    ).rejects.toThrow()
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(existsSync(join(outside, "target.md"))).toBe(false)
  })
})

describe("every path the vault composes stays inside its boundary", () => {
  it("a `memory/` folder of the vault that links outside is refused, on the next call too, and nothing is written there", () => {
    open() // the composition is now cached: the link must be refused even though the cache would have answered
    symlinkSync(outside, join(worktree, ".unifia", "memory", "memory"))
    expect(() => open()).toThrow(VaultLocationRefused)
    expect(() => open({ create: false, writable: false })).toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })

  it("a `.unifia` folder of the vault that links outside is refused, and the WAL, trash and policy are not written there", () => {
    open()
    // The writer created the internal folder on the first open; a link committed in its place is what this case models.
    rmSync(join(worktree, ".unifia", "memory", ".unifia"), { recursive: true, force: true })
    symlinkSync(outside, join(worktree, ".unifia", "memory", ".unifia"))
    expect(() => open()).toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })

  it("a configured vault whose own `memory/` folder links outside the vault is refused", () => {
    const vault = join(worktree, "vault")
    mkdirSync(vault)
    symlinkSync(outside, join(vault, "memory"))
    expect(() => openMemory({
      worktree,
      settings: { directory: vault },
      providerId: "unifia-ui",
      destinationKind: "local",
      audience: "owner",
      writable: true,
      create: true,
    })).toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })

  it("a configured vault whose `memory/` folder links to a folder inside the same vault is accepted", () => {
    const vault = join(worktree, "vault-inner")
    mkdirSync(join(vault, "store"), { recursive: true })
    symlinkSync(join(vault, "store"), join(vault, "memory"))
    expect(openMemory({
      worktree,
      settings: { directory: vault },
      providerId: "unifia-ui",
      destinationKind: "local",
      audience: "owner",
      writable: true,
      create: true,
    })).toBeDefined()
  })

  it("the MCP composition, which takes a project root from its caller, refuses a `memory/` link out of the project", () => {
    symlinkSync(outside, join(worktree, "memory"))
    expect(() => composeKnowledgeService({ workspaceRoot: worktree, providerId: "mcp", destinationKind: "remote" }))
      .toThrow(VaultLocationRefused)
    expect(readdirSync(outside)).toEqual([])
  })
})
