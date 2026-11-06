/* SPDX-License-Identifier: MIT */
// The rootfs bundled in the APK was populated by apk at build time, so its
// files are owned by packages this manager never installed. Their apk
// database is adopted once as a pinned base (ADR-097): base packages satisfy
// dependencies as they are, are never removed by a change, and do not count
// against the quota, since the user never asked for them.
import fs from "node:fs"
import path from "node:path"
import type { ExtractedFile } from "./archive"
import { parseIndex, replaces } from "./repository"
import { type Database, hasDatabase, type PackageRecord, readDatabase, writeDatabase } from "./transaction"

export const INSTALLED_DATABASE = "lib/apk/db/installed"

// Same block format as APKINDEX, plus F: (directory) and R: (file in the last F:) lines.
export function parseInstalledDatabase(text: string): PackageRecord[] {
  const blocks = text.split(/\n\s*\n/).filter((block) => block.trim() !== "")
  return blocks.map((block) => {
    const [entry] = parseIndex(block)
    const files: ExtractedFile[] = []
    let directory = ""
    for (const line of block.split("\n")) {
      if (line.startsWith("F:")) {
        directory = line.slice(2)
        files.push({ path: directory, type: "directory" })
      } else if (line.startsWith("R:")) {
        files.push({ path: path.posix.join(directory, line.slice(2)), type: "file" })
      }
    }
    return { entry: entry!, apkSha256: "", files, explicit: false, base: true }
  })
}

export function adoptBase(root: string): Database | undefined {
  const file = path.join(root, INSTALLED_DATABASE)
  if (!fs.existsSync(file)) return undefined
  const packages: Record<string, PackageRecord> = {}
  for (const record of parseInstalledDatabase(fs.readFileSync(file, "utf8"))) packages[record.entry.name] = record
  return { version: 1, packages }
}

// The rootfs can be replaced under the manager: a new APK extracts it again, and the database kept beside it
// then names packages the new rootfs does not ship, or whose files are gone. The rootfs is the truth: base
// packages come from its own apk database, and any other record is kept only while its files are on disk.
// `requests` is kept, so an install the user asked for is restored by the next change. A fresh rootfs
// wipes the replacement's files, which brings the base package it replaced back.
export function reconcileDatabase(root: string, state: string): void {
  const shipped = adoptBase(root)
  if (!shipped) return
  if (!hasDatabase(state)) {
    writeDatabase(state, shipped)
    return
  }
  const current = readDatabase(state)
  const packages: Record<string, PackageRecord> = { ...shipped.packages }
  for (const [name, record] of Object.entries(current.packages)) {
    if (record.base || shipped.packages[name]) continue
    if (filesOnDisk(root, record)) packages[name] = record
  }
  // A base package an installed one replaced stays in the rootfs apk database, but its files now belong to the replacement.
  const managed = Object.values(packages).filter((record) => !record.base)
  for (const [name, record] of Object.entries(shipped.packages)) {
    if (managed.some((other) => replaces(other.entry, record.entry))) delete packages[name]
  }
  if (sameRecords(current.packages, packages)) return
  writeDatabase(state, { ...current, packages })
}

// lstat, not stat: an absolute symlink (Alpine's usr/bin/mvn) resolves only inside the rootfs, so it is present.
function filesOnDisk(root: string, record: PackageRecord): boolean {
  return record.files.every((file) => file.type === "directory" || lexists(path.join(root, file.path)))
}

function lexists(file: string): boolean {
  try {
    fs.lstatSync(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function sameRecords(left: Readonly<Record<string, PackageRecord>>, right: Readonly<Record<string, PackageRecord>>): boolean {
  const names = Object.keys(left)
  return names.length === Object.keys(right).length && names.every((name) => right[name] !== undefined && JSON.stringify(left[name]) === JSON.stringify(right[name]))
}
