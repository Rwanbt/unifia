// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { walk } from "./tree"

// The npm-style SRI string of a file, as published in the registry metadata (dist.integrity).
export async function sri512(file: string) {
  return `sha512-${createHash("sha512").update(await readFile(file)).digest("base64")}`
}

// The Go module dirhash (h1) that sum.golang.org records: one "<sha256 hex>  <name>\n" line per
// regular file, sorted by name in byte order, hashed once more. Names are relative to `dir`.
export async function h1(dir: string) {
  const names = (await walk(dir)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  const summary = createHash("sha256")
  for (const name of names) {
    const digest = createHash("sha256").update(await readFile(path.join(dir, name))).digest("hex")
    summary.update(`${digest}  ${name}\n`)
  }
  return `h1:${summary.digest("base64")}`
}
