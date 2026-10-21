// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { mkdir } from "node:fs/promises"
import { capture } from "./exec"
import { walk } from "./tree"

export type Archive = "tar.gz" | "tar.xz" | "zip"

// The tar flags for a compressed tarball: list with -t, extract with -x, and -z or -J for the codec.
const tarFlags = (archive: Archive, mode: "t" | "x") => (archive === "tar.xz" ? `${mode}J` : `${mode}z`)

// A member name must sit under the declared prefix, or be one of the prefix's parent directories.
// It must never be absolute and never contain a ".." segment.
function unsafe(name: string, prefix: string) {
  const clean = name.replace(/\/+$/, "")
  if (clean.startsWith("/") || clean.split("/").includes("..")) return true
  return !(clean === prefix || clean.startsWith(`${prefix}/`) || `${prefix}/`.startsWith(`${clean}/`))
}

// Names are read before anything is written, so a hostile name never reaches the disk.
async function members(file: string, archive: Archive) {
  const cmd = archive === "zip" ? ["unzip", "-Z1", file] : ["tar", `-${tarFlags(archive, "t")}f`, file]
  const out = await capture(cmd)
  if (out.code !== 0) throw new Error(`cannot list ${file}: ${out.stderr.trim()}`)
  return out.stdout.split("\n").filter((line) => line.length > 0)
}

// Extracts an archive into `dest` and returns the regular files it produced. The tree is checked
// again after extraction, because a member that passed the name check can still be a symlink.
export async function extract(file: string, archive: Archive, prefix: string, dest: string) {
  const bad = (await members(file, archive)).find((name) => unsafe(name, prefix))
  if (bad !== undefined) throw new Error(`unsafe archive member: ${bad}`)
  await mkdir(dest, { recursive: true })
  const cmd =
    archive === "zip"
      ? ["unzip", "-q", "-o", file, "-d", dest]
      : ["tar", "--no-same-owner", `-${tarFlags(archive, "x")}f`, file, "-C", dest]
  const out = await capture(cmd)
  if (out.code !== 0) throw new Error(`extraction failed: ${out.stderr.trim()}`)
  return walk(dest)
}
