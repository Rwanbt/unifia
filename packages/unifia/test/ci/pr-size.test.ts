/* SPDX-License-Identifier: MIT */
/**
 * The pull request size check is a governance gate. A count taken from a base that is not there is zero, and zero passes the
 * limit, so the script must refuse to count in that case, and must count only what this branch changed.
 */

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const script = path.resolve(import.meta.dir, "../../../../scripts/check-pr-size.sh")
const git = ["-c", "user.name=t", "-c", "user.email=t@t.test", "-c", "commit.gpgsign=false"]

function run(cwd: string, args: string[]) {
  const result = spawnSync("git", [...git, ...args], { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i}`).join("\n") + "\n"
}

function checkSize(cwd: string, base: string) {
  return spawnSync("bash", [script, base], { cwd, encoding: "utf8" })
}

function repo(): string {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "unifia-pr-size-"))
  run(dir, ["init", "-q", "-b", "main"])
  writeFileSync(path.join(dir, "a.txt"), lines(1))
  run(dir, ["add", "."])
  run(dir, ["commit", "-q", "-m", "base"])
  return dir
}

describe("the pull request size check", () => {
  test("a base that is not available fails closed, and reports no count", () => {
    const dir = repo()
    try {
      const result = checkSize(dir, "origin/dev")
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("not available")
      expect(result.stdout).not.toContain("Changed lines")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("counts only the lines this branch changed, not commits that reached the base later", () => {
    const dir = repo()
    try {
      run(dir, ["checkout", "-q", "-b", "feature"])
      writeFileSync(path.join(dir, "f.txt"), lines(3))
      run(dir, ["add", "."])
      run(dir, ["commit", "-q", "-m", "feature"])
      run(dir, ["checkout", "-q", "main"])
      writeFileSync(path.join(dir, "big.txt"), lines(1000))
      run(dir, ["add", "."])
      run(dir, ["commit", "-q", "-m", "later on main"])
      run(dir, ["checkout", "-q", "feature"])

      const result = checkSize(dir, "main")
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Changed lines (excluding generated and lockfiles): 3")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a branch whose first changed file only loses lines is counted, not stopped", () => {
    const dir = repo()
    try {
      writeFileSync(path.join(dir, "a.txt"), lines(5))
      run(dir, ["add", "."])
      run(dir, ["commit", "-q", "-m", "five lines"])
      run(dir, ["checkout", "-q", "-b", "feature"])
      // a.txt sorts first in the numstat and has no added line: the count is still 0 after its added field.
      writeFileSync(path.join(dir, "a.txt"), lines(3))
      writeFileSync(path.join(dir, "b.txt"), lines(2))
      run(dir, ["add", "."])
      run(dir, ["commit", "-q", "-m", "shrink a, add b"])

      const result = checkSize(dir, "main")
      expect(result.stderr).toBe("")
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Changed lines (excluding generated and lockfiles): 4")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a change above the limit still fails", () => {
    const dir = repo()
    try {
      run(dir, ["checkout", "-q", "-b", "feature"])
      writeFileSync(path.join(dir, "big.txt"), lines(401))
      run(dir, ["add", "."])
      run(dir, ["commit", "-q", "-m", "large"])

      const result = checkSize(dir, "main")
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("PR size limit exceeded")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
