// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { readdir } from "node:fs/promises"
import path from "node:path"

// Returns the relative paths of the regular files under `dir`. A symlink, device, socket or fifo
// is refused: a link can point outside the install root, and a special file is never a toolchain.
export async function walk(dir: string, rel = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, rel), { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (item) => {
      const next = path.posix.join(rel, item.name)
      if (item.isDirectory()) return walk(dir, next)
      if (item.isFile()) return [next]
      throw new Error(`unsafe archive member (not a regular file or directory): ${next}`)
    }),
  )
  return nested.flat()
}
