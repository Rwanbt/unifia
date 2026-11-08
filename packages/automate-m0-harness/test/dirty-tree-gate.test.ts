/* SPDX-License-Identifier: MIT */
/**
 * Regression for the canonical M0 writer's real worktree predicate.
 * Use an isolated Git fixture: CI runs from a clean checkout, and tests must
 * never modify or depend on the caller's actual working tree.
 */
import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isWorktreeClean } from "../../../scripts/m0-worktree-guard.ts"

describe("canonical writer dirty-tree gate (mandate §15)", () => {
  test("allows a clean Git worktree and refuses an untracked change", () => {
    const cwd = mkdtempSync(join(tmpdir(), "unifia-m0-guard-"))
    try {
      execFileSync("git", ["init", "-q"], { cwd, timeout: 15_000 })
      expect(isWorktreeClean(cwd)).toBe(true)
      writeFileSync(join(cwd, "dirty.txt"), "uncommitted data")
      expect(isWorktreeClean(cwd)).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("refuses publication when the directory is not a Git worktree", () => {
    const cwd = mkdtempSync(join(tmpdir(), "unifia-m0-nongit-"))
    try {
      expect(isWorktreeClean(cwd)).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
