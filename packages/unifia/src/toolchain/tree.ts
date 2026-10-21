// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { lstat, readdir, readlink } from "node:fs/promises"
import path from "node:path"

// A symlink is allowed only when its target stays inside the tree, and each hop of a chain does too.
// A link may end in another link (Debian sonames do), but a link may not sit in the middle of a target
// path, because that path would then be resolved through the link. A target that does not exist yet is
// allowed: it cannot escape. Depth is bounded, so a loop of links is refused.
async function inside(dir: string, rel: string, depth = 0): Promise<boolean> {
  if (depth > 8) return false
  const target = await readlink(path.join(dir, rel))
  if (path.posix.isAbsolute(target)) return false
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), target))
  if (resolved === "." || resolved === ".." || resolved.startsWith("../")) return false
  const parts = resolved.split("/")
  for (let i = 1; i <= parts.length; i++) {
    const at = parts.slice(0, i).join("/")
    const info = await lstat(path.join(dir, at)).catch(() => undefined)
    if (info === undefined) return true
    if (!info.isSymbolicLink()) continue
    return i === parts.length ? inside(dir, at, depth + 1) : false
  }
  return true
}

// Returns the relative paths of the regular files under `dir`. Other links, devices, sockets and
// fifos are refused: a link can point outside the install root, and a special file is never a
// toolchain. An allowed link is not a file of its own, so it is not listed.
export async function walk(dir: string, rel = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, rel), { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (item) => {
      const next = path.posix.join(rel, item.name)
      if (item.isDirectory()) return walk(dir, next)
      if (item.isFile()) return [next]
      if (item.isSymbolicLink() && (await inside(dir, next))) return []
      throw new Error(`unsafe archive member (not a regular file or directory): ${next}`)
    }),
  )
  return nested.flat()
}
