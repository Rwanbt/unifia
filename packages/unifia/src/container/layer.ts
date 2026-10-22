/* SPDX-License-Identifier: MIT */
// Applies OCI image layers onto a container rootfs (ADR-098). Unlike the
// toolchain staging area, an image legitimately routes paths through
// symlinked directories (/bin -> usr/bin), so every path is resolved inside
// the root like a chroot would: an absolute link starts at the container
// root and `..` stops there. Nothing is ever written outside the root.
import fs from "node:fs"
import path from "node:path"
import type { TarEntry } from "../toolchain/archive"

export class LayerError extends Error {
  override name = "LayerError"
}

const MAX_SYMLINK_HOPS = 40
const WHITEOUT = ".wh."
const OPAQUE = ".wh..wh..opq"
// Windows has no O_NOFOLLOW; there the layer tests that rely on symlinks are skipped.
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0

// Resolves `relative` under `root`, following symlinks in every component but
// the last (the entry itself is created, replaced or removed, never followed).
export function resolveInRoot(root: string, relative: string): string {
  const pending = relative.split("/").filter((part) => part !== "" && part !== ".")
  const resolved: string[] = []
  let hops = 0
  while (pending.length > 0) {
    const part = pending.shift()!
    if (part === "..") {
      resolved.pop()
      continue
    }
    const candidate = path.join(root, ...resolved, part)
    const stat = pending.length > 0 ? fs.lstatSync(candidate, { throwIfNoEntry: false }) : undefined
    if (!stat?.isSymbolicLink()) {
      resolved.push(part)
      continue
    }
    if (++hops > MAX_SYMLINK_HOPS) throw new LayerError(`too many symlinks resolving "${relative}"`)
    const target = fs.readlinkSync(candidate)
    if (target.startsWith("/")) resolved.length = 0
    pending.unshift(...target.split("/").filter((piece) => piece !== "" && piece !== "."))
  }
  return path.join(root, ...resolved)
}

function ensureDirectory(target: string, mode: number) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false })
  if (stat?.isDirectory()) return
  if (stat) fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true, mode: mode | 0o700 })
}

function clearDirectory(directory: string) {
  if (!fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return
  for (const child of fs.readdirSync(directory)) fs.rmSync(path.join(directory, child), { recursive: true, force: true })
}

// Whiteouts first, so a layer never deletes what it adds itself.
function applyWhiteouts(entries: readonly TarEntry[], root: string) {
  for (const entry of entries) {
    const name = path.posix.basename(entry.path)
    if (!name.startsWith(WHITEOUT)) continue
    const parent = resolveInRoot(root, path.posix.dirname(entry.path))
    if (name === OPAQUE) clearDirectory(parent)
    else fs.rmSync(path.join(parent, name.slice(WHITEOUT.length)), { recursive: true, force: true })
  }
}

function writeEntry(entry: TarEntry, root: string, written: Map<string, string>) {
  const target = resolveInRoot(root, entry.path)
  if (entry.type === "directory") return ensureDirectory(target, entry.mode)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const existing = fs.lstatSync(target, { throwIfNoEntry: false })
  if (existing) fs.rmSync(target, { recursive: true, force: true })
  if (entry.type === "symlink") return fs.symlinkSync(entry.linkTarget!, target)
  // SELinux denies link() in app data on Android, so hardlinks become copies.
  const data = entry.type === "hardlink" ? readRegularFile(written.get(entry.linkTarget!) ?? resolveInRoot(root, entry.linkTarget!), entry.path) : entry.data
  writeNewFile(target, data, entry.mode)
  written.set(entry.path, target)
}

// The checks happen on the open descriptor, never on the path again, so a file
// swapped for a symlink between check and use is refused instead of followed.
function readRegularFile(source: string, entryPath: string): Uint8Array {
  let descriptor: number
  try {
    descriptor = fs.openSync(source, fs.constants.O_RDONLY | NO_FOLLOW)
  } catch {
    throw new LayerError(`hardlink "${entryPath}" has no file to copy`)
  }
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new LayerError(`hardlink "${entryPath}" has no file to copy`)
    return fs.readFileSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function writeNewFile(target: string, data: Uint8Array, mode: number) {
  const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW, mode)
  try {
    fs.writeSync(descriptor, data)
    fs.fchmodSync(descriptor, mode)
  } finally {
    fs.closeSync(descriptor)
  }
}

export function applyLayer(entries: readonly TarEntry[], root: string) {
  applyWhiteouts(entries, root)
  const written = new Map<string, string>()
  for (const entry of entries) {
    if (!path.posix.basename(entry.path).startsWith(WHITEOUT)) writeEntry(entry, root, written)
  }
}
