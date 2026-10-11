/* SPDX-License-Identifier: MIT */
/**
 * Which memory location the configuration may choose (ADR-092).
 *
 * A repository's own configuration cannot name a folder outside itself as the agent's memory. The user's configuration
 * can, and only the place it names; a link is judged by where it really leads.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decideMemoryDirectory } from "../../src/config/memory-trust"

let base: string
let worktree: string
let outside: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unifia-memtrust-"))
  worktree = join(base, "project")
  outside = join(base, "outside")
  mkdirSync(worktree)
  mkdirSync(outside)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe("the memory location the configuration names", () => {
  it("names none: the default vault", () => {
    expect(decideMemoryDirectory(worktree, undefined, undefined)).toBe("default")
    expect(decideMemoryDirectory(worktree, "   ", undefined)).toBe("default")
  })

  it("a relative location inside the project is the project's own, and is honoured", () => {
    expect(decideMemoryDirectory(worktree, "store/memory", undefined)).toBe("inside")
  })

  it("an absolute location inside the project is honoured too: the path is judged by where it is", () => {
    expect(decideMemoryDirectory(worktree, join(worktree, "store"), undefined)).toBe("inside")
  })

  it("a location outside the project, named only by the project, is refused", () => {
    expect(decideMemoryDirectory(worktree, join(outside, "vault"), undefined)).toBe("refused")
  })

  it("a relative location that climbs out of the project, named only by the project, is refused", () => {
    expect(decideMemoryDirectory(worktree, "../outside/vault", undefined)).toBe("refused")
  })

  it("a link inside the project that leads outside is outside, and refused when only the project names it", () => {
    symlinkSync(outside, join(worktree, "store"))
    expect(decideMemoryDirectory(worktree, "store/memory", undefined)).toBe("refused")
  })

  it("a dangling link inside the project that points outside is judged by its target, not as inside", () => {
    symlinkSync(join(outside, "missing"), join(worktree, "vault"))
    expect(decideMemoryDirectory(worktree, "vault", undefined)).toBe("refused")
  })

  it("a location outside the project that the user's configuration names as well is honoured: the owner's own vault", () => {
    const vault = join(outside, "obsidian")
    expect(decideMemoryDirectory(worktree, vault, vault)).toBe("user")
  })

  it("the user's naming covers the same place through a link", () => {
    const vault = join(outside, "obsidian")
    mkdirSync(vault)
    symlinkSync(vault, join(base, "alias"))
    expect(decideMemoryDirectory(worktree, join(base, "alias"), vault)).toBe("user")
  })

  it("a location the project names outside is refused when the user names another place", () => {
    expect(decideMemoryDirectory(worktree, join(outside, "a"), join(outside, "b"))).toBe("refused")
  })

  it("a location the project names outside is refused when the user's place is inside the project", () => {
    expect(decideMemoryDirectory(worktree, join(outside, "vault"), "store")).toBe("refused")
  })
})
