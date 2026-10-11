/* SPDX-License-Identifier: MIT */
/**
 * Which memory location the configuration may choose (ADR-092).
 *
 * The memory directory is read from the merged configuration, and a repository's own `opencode.json` is one of its layers.
 * A repository you clone could therefore name a folder outside itself, and the agent would read and write that folder as
 * its memory. So a location outside the project is honoured only when the user's own configuration names the same place.
 * A location inside the project is the project's own business, and is honoured as written.
 *
 * Decided on canonical paths: a link inside the project that leads outside it is outside. Absolute paths are not
 * permissions: an absolute path is judged by where it is, like any other.
 */

import { readlinkSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { Config } from "./config"
import { resolveMemoryRoot, type MemorySettings } from "../knowledge/app/memory.js"
import { realOrNull } from "../knowledge/source/containment.js"
import { Log } from "../util/log"

const log = Log.create({ service: "config.memory" })

/** Refused without the path: the agent and its logs see this message. */
export class MemoryDirectoryRefused extends Error {
  constructor() {
    super(
      "the project's configuration names a memory location outside the project; only the user's own configuration may choose one",
    )
    this.name = "MemoryDirectoryRefused"
  }
}

export type MemoryDirectoryDecision =
  /** No location named: the default vault inside the project. */
  | "default"
  /** A location inside the project, whatever configuration names it. */
  | "inside"
  /** A location outside the project that the user's configuration names as well. */
  | "user"
  /** A location outside the project named only by the project's configuration. */
  | "refused"

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ""
}

/**
 * The real location of `path`, through its nearest existing ancestor. A link that does not resolve (dangling) is judged
 * by where it points, not by its parent: creating through it would create its target. A location that does not exist
 * yet is still judged, by where its existing part really is.
 */
function canonicalPath(path: string, hops = 0): string {
  const real = realOrNull(path)
  if (real !== null) return real
  const target = linkTarget(path)
  if (target !== undefined && hops < MAX_LINK_HOPS) {
    return canonicalPath(resolve(dirname(path), target), hops + 1)
  }
  const parent = dirname(path)
  if (parent === path) return path
  return join(canonicalPath(parent, hops), basename(path))
}

const MAX_LINK_HOPS = 32

/** Where a symbolic link at `path` points, or undefined when there is none. One read, with no look at the path first. */
function linkTarget(path: string): string | undefined {
  try {
    return readlinkSync(path)
  } catch {
    return undefined
  }
}

/** True when `path` is `root` or lies under it. Both are canonical. */
function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  if (rel === "") return true
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Decide where the configured memory location stands, given the merged and the user-level directory settings. */
export function decideMemoryDirectory(
  worktree: string,
  merged: string | undefined,
  user: string | undefined,
): MemoryDirectoryDecision {
  if (blank(merged)) return "default"
  const target = canonicalPath(resolveMemoryRoot(worktree, { directory: merged }))
  if (within(canonicalPath(resolve(worktree)), target)) return "inside"
  if (!blank(user) && canonicalPath(resolveMemoryRoot(worktree, { directory: user })) === target) return "user"
  return "refused"
}

/**
 * The memory settings this project may use. A location the project alone names, outside the project, is refused: every
 * surface that opens the vault goes through here, so the refusal is the same whichever one asks.
 */
export async function trustedMemorySettings(worktree: string): Promise<MemorySettings | undefined> {
  const merged = (await Config.get()).memory
  const user = (await Config.getGlobal()).memory?.directory
  const decision = decideMemoryDirectory(worktree, merged?.directory, user)
  if (decision !== "refused") return merged
  log.warn("memory location refused: named only by the project configuration, outside the project")
  throw new MemoryDirectoryRefused()
}
