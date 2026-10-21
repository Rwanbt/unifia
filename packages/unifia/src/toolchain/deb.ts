// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { mkdir, readdir, readlink, rm } from "node:fs/promises"
import path from "node:path"
import { capture } from "./exec"
import { walk } from "./tree"

// Debian data paths start with "./". After that prefix a name must stay inside the tree: no
// absolute name and no ".." segment.
function unsafe(name: string) {
  const clean = name.replace(/^\.\//, "").replace(/\/+$/, "")
  if (clean === "" || clean === ".") return false
  return clean.startsWith("/") || clean.split("/").includes("..")
}

// The tar flag that decompresses the data member, from its file name.
function codec(member: string) {
  if (member.endsWith(".zst")) return ["--zstd"]
  if (member.endsWith(".xz")) return ["-J"]
  if (member.endsWith(".gz")) return ["-z"]
  throw new Error(`unsupported data member in package: ${member}`)
}

// Absolute links point into the root of the system the package was built for. Inside an install root
// they would reach the host's own files, so they are removed here and reported, never followed.
async function dropAbsoluteLinks(dir: string, rel = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, rel), { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (item) => {
      const next = path.posix.join(rel, item.name)
      if (item.isDirectory()) return dropAbsoluteLinks(dir, next)
      if (!item.isSymbolicLink()) return []
      if (!path.posix.isAbsolute(await readlink(path.join(dir, next)))) return []
      await rm(path.join(dir, next), { force: true })
      return [next]
    }),
  )
  return nested.flat()
}

// Unpacks a .deb's data member into `dest`. The member names are checked before anything is written.
// Absolute links are dropped and listed in `dropped`; the remaining tree is checked by walk().
export async function unpackDeb(file: string, dest: string) {
  const listed = await capture(["ar", "t", file])
  if (listed.code !== 0) throw new Error(`cannot read package ${file}: ${listed.stderr.trim()}`)
  const member = listed.stdout.split("\n").find((name) => name.startsWith("data.tar"))
  if (member === undefined) throw new Error(`no data member in package ${file}`)

  const scratch = `${dest}.ar`
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  const extracted = await capture(["ar", "x", path.resolve(file), member], { cwd: scratch })
  if (extracted.code !== 0) throw new Error(`cannot extract data member: ${extracted.stderr.trim()}`)
  const data = path.join(scratch, member)

  const flags = codec(member)
  const names = await capture(["tar", ...flags, "-tf", data])
  if (names.code !== 0) throw new Error(`cannot list data member: ${names.stderr.trim()}`)
  const bad = names.stdout.split("\n").find((name) => name.length > 0 && unsafe(name))
  if (bad !== undefined) throw new Error(`unsafe archive member: ${bad}`)

  await mkdir(dest, { recursive: true })
  const out = await capture(["tar", "--no-same-owner", ...flags, "-xf", data, "-C", dest])
  await rm(scratch, { recursive: true, force: true })
  if (out.code !== 0) throw new Error(`package extraction failed: ${out.stderr.trim()}`)
  const dropped = await dropAbsoluteLinks(dest)
  return { files: await walk(dest), dropped }
}
