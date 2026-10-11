/* SPDX-License-Identifier: MIT */
/**
 * Where the default memory vault may live: inside its project.
 *
 * The default vault is `.unifia/memory` under the project root. Any link on that path (a symbolic link or a
 * junction committed with the repository, or left by an earlier run) can point it anywhere. Every surface that
 * opens the vault reaches it through `openMemory`, so the check lives there: the agent's tools, the recall in the
 * system prompt, the CLI and the server cannot disagree about where the vault is.
 *
 * A configured `memory.directory` is not checked here. That location is the owner's own choice, and the rule for
 * it is documented separately (see docs/adr/ADR-092-memory-directory-policy.md).
 */

import { lstatSync } from "node:fs"
import { dirname } from "node:path"
import { isContained } from "../source/containment.js"

/**
 * The default vault resolves outside its project. The message names no path: a refusal must not tell the caller
 * where the vault really is.
 */
export class VaultLocationRefused extends Error {
  constructor() {
    super("memory vault location is not inside its boundary")
    this.name = "VaultLocationRefused"
  }
}

/**
 * Refuse a vault root that is not inside `worktree`, judged on real paths.
 *
 * A vault that does not exist yet is created where its deepest existing part points, so that part decides. A
 * dangling link counts as existing: creating through it would create its target. `isContained` compares real
 * paths, so a link that stays inside the project is accepted, and a link that cannot be resolved is refused.
 */
export function assertVaultRootInside(worktree: string, root: string): void {
  if (!isContained(worktree, deepestPresent(root))) throw new VaultLocationRefused()
}

/** The deepest part of `path` that exists, a dangling link included. */
function deepestPresent(path: string): string {
  let current = path
  while (!existsOrIsLink(current)) {
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

/** Whether a path exists, or is a link even a dangling one: `existsSync` follows links and would miss the latter. */
function existsOrIsLink(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
