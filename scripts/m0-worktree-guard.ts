/* SPDX-License-Identifier: MIT */
import { execFileSync } from "node:child_process"

/** Canonical evidence may only be published from a clean Git worktree. */
export function isWorktreeClean(repoRoot: string): boolean {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim().length === 0
  } catch {
    return false
  }
}
