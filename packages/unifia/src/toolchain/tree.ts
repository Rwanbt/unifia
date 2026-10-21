// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { lstat, readdir, readlink } from "node:fs/promises"
import path from "node:path"

// A symlink is allowed only when it is relative, resolves inside the tree, and points at a regular
// file or directory rather than another link. Node.js ships its npm and npx this way.
async function inside(dir: string, rel: string) {
  const target = await readlink(path.join(dir, rel))
  if (path.posix.isAbsolute(target)) return false
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), target))
  if (resolved === "." || resolved === ".." || resolved.startsWith("../")) return false
  const info = await lstat(path.join(dir, resolved)).catch(() => undefined)
  return info !== undefined && (info.isFile() || info.isDirectory())
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
