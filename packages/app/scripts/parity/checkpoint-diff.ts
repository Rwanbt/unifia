// SPDX-License-Identifier: MIT
import { execFileSync, spawnSync } from "node:child_process"

export function checkpointDiff(repository: string): { names: string; numstat: string } {
  const merge = spawnSync("git", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { cwd: repository, encoding: "utf8" })
  if (merge.error) throw merge.error
  if (merge.status !== 0 && merge.status !== 1) throw new Error(`Cannot inspect merge parent: ${merge.stderr.trim()}`)
  // Inherited changes were already reviewed on the incoming branch; keep the feature and resolution changes visible.
  const base = merge.status === 0 ? [merge.stdout.trim()] : []
  const diff = (format: string) => execFileSync("git", ["diff", "--cached", ...base, format], { cwd: repository, encoding: "utf8" })
  return { names: diff("--name-only"), numstat: diff("--numstat") }
}
