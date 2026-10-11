/* SPDX-License-Identifier: MIT */
/**
 * The default vault stays inside its project, whichever surface opens it.
 *
 * A `.unifia` committed as a link, or left as one, pointed the vault outside the project: the first create wrote
 * the policy and the notes there. `openMemory` is the one place every surface passes through, so the boundary is
 * tested there. The refusal is decided before anything is read or created, and it names no path.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openMemory, resetMemoryCache } from "../../../src/knowledge/app/memory.js"
import { VaultLocationRefused } from "../../../src/knowledge/app/project-boundary.js"

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
})
