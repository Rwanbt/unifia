// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkpointDiff } from "./checkpoint-diff"

function repository(run: (directory: string, git: (...args: string[]) => string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "unifia-checkpoint-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
    git("init", "-b", "base")
    git("config", "user.name", "Checkpoint test")
    git("config", "user.email", "checkpoint@example.invalid")
    git("config", "core.hooksPath", ".no-hooks")
    writeFileSync(join(directory, "policy.json"), "original\n")
    writeFileSync(join(directory, "view.ts"), "original\n")
    git("add", ".")
    git("commit", "-m", "test: seed repository")
    run(directory, git)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("CheckpointDiff_Integration", () => {
  test("OrdinaryCommit_PreservesAllStagedChanges", () => {
    repository((directory, git) => {
      writeFileSync(join(directory, "policy.json"), "changed\n")
      writeFileSync(join(directory, "view.ts"), "changed\n")
      git("add", ".")
      expect(checkpointDiff(directory).names.trim().split("\n")).toEqual(["policy.json", "view.ts"])
    })
  })

  test("Merge_ExcludesInheritedPolicyAndKeepsBranchUi", () => {
    repository((directory, git) => {
      git("checkout", "-b", "feature")
      writeFileSync(join(directory, "view.ts"), "feature\n")
      git("add", ".")
      git("commit", "-m", "test: change feature UI")
      git("checkout", "base")
      writeFileSync(join(directory, "policy.json"), "incoming policy\n")
      git("add", ".")
      git("commit", "-m", "test: change base policy")
      git("checkout", "feature")
      git("merge", "--no-commit", "--no-ff", "base")
      const diff = checkpointDiff(directory)
      expect(diff.names.trim()).toBe("view.ts")
      expect(diff.numstat).toContain("view.ts")
      expect(diff.numstat).not.toContain("policy.json")
      writeFileSync(join(directory, "resolution.ts"), "resolution\n")
      writeFileSync(join(directory, "policy.json"), "resolution policy\n")
      git("add", ".")
      expect(checkpointDiff(directory).names).toContain("resolution.ts")
      expect(checkpointDiff(directory).names).toContain("policy.json")
    })
  })

  test("InvalidRepository_FailsExplicitly", () => {
    const directory = mkdtempSync(join(tmpdir(), "unifia-checkpoint-invalid-"))
    try {
      expect(() => checkpointDiff(directory)).toThrow("Cannot inspect merge parent")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
