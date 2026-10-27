/* SPDX-License-Identifier: MIT */
// Applies a toolchain change to the rootfs as one journaled transaction.
// The journal lists every planned file move before the first one happens,
// so a crash at any point leaves enough on disk to undo the change
// (`recoverTransaction`). The database rename is the commit point.
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { ExtractedFile } from "./archive"
import type { IndexPackage } from "./repository"

export class TransactionError extends Error {
  override name = "TransactionError"
}

export interface PackageRecord {
  readonly entry: IndexPackage
  readonly apkSha256: string
  readonly files: readonly ExtractedFile[]
  readonly explicit: boolean
  // Shipped in the bundled rootfs, adopted from its apk database (see base.ts).
  readonly base?: true
}

export interface Database {
  readonly version: 1
  readonly packages: Readonly<Record<string, PackageRecord>>
  // What the user asked for, as typed: often a name another package provides (clang -> clang19).
  readonly requests?: readonly string[]
}

export interface StagedPackage {
  readonly record: PackageRecord
  readonly stagingDir: string
}

interface Operation {
  readonly path: string
  readonly source?: string
  readonly hadOriginal: boolean
}

interface Journal {
  readonly id: string
  readonly operations: readonly Operation[]
  readonly previous: Database
  readonly committed: boolean
}

export interface TransactionHooks {
  // Test seam: lets a test simulate a crash between two file moves.
  readonly afterOperation?: (index: number) => void
}

export const emptyDatabase = (): Database => ({ version: 1, packages: {} })
const files = (state: string) => ({
  database: path.join(state, "db.json"),
  journal: path.join(state, "journal.json"),
  backup: (id: string) => path.join(state, "backup", id),
  lock: path.join(state, "lock"),
})

function writeAtomically(target: string, value: unknown) {
  const temporary = `${target}.${process.pid}.tmp`
  const handle = fs.openSync(temporary, "w")
  fs.writeSync(handle, JSON.stringify(value))
  fs.fsyncSync(handle)
  fs.closeSync(handle)
  fs.renameSync(temporary, target)
}

export function writeDatabase(state: string, database: Database) {
  writeAtomically(files(state).database, database)
}

export function hasDatabase(state: string): boolean {
  return fs.existsSync(files(state).database)
}

export function readDatabase(state: string): Database {
  const file = files(state).database
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Database) : emptyDatabase()
}

// Every ancestor inside the root must be a real directory: an absolute
// symlink there would resolve against the device root, not the rootfs.
function ensureDirectory(root: string, relative: string) {
  let current = root
  for (const part of relative.split("/").filter(Boolean)) {
    current = path.join(current, part)
    const stat = fs.lstatSync(current, { throwIfNoEntry: false })
    if (!stat) fs.mkdirSync(current, { mode: 0o755 })
    else if (!stat.isDirectory()) throw new TransactionError(`"${path.relative(root, current)}" is not a directory`)
  }
}

function sameContent(existing: string, staged: string): boolean {
  const [a, b] = [fs.lstatSync(existing), fs.lstatSync(staged)]
  if (a.isSymbolicLink() || b.isSymbolicLink()) return a.isSymbolicLink() && b.isSymbolicLink() && fs.readlinkSync(existing) === fs.readlinkSync(staged)
  const digest = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  return a.isFile() && b.isFile() && digest(existing) === digest(staged)
}

function owners(database: Database): Map<string, string> {
  const owned = new Map<string, string>()
  for (const [name, record] of Object.entries(database.packages)) {
    for (const file of record.files) if (file.type !== "directory") owned.set(file.path, name)
  }
  return owned
}

function plan(root: string, current: Database, next: Database, staged: readonly StagedPackage[]): Operation[] {
  const before = owners(current)
  const after = new Map<string, string>()
  const operations: Operation[] = []
  for (const item of staged) {
    const name = item.record.entry.name
    for (const file of item.record.files) {
      if (file.type === "directory") continue
      const clash = after.get(file.path)
      if (clash) throw new TransactionError(`${name} and ${clash} both ship "${file.path}"`)
      after.set(file.path, name)
      const destination = path.join(root, file.path)
      const exists = fs.lstatSync(destination, { throwIfNoEntry: false }) !== undefined
      const previousOwner = before.get(file.path)
      if (exists && previousOwner && previousOwner !== name && next.packages[previousOwner]) {
        throw new TransactionError(`"${file.path}" belongs to ${previousOwner}, which ${name} would overwrite`)
      }
      const source = path.join(item.stagingDir, file.path)
      if (exists && !previousOwner) {
        if (!sameContent(destination, source)) throw new TransactionError(`"${file.path}" is an unmanaged file that ${name} would overwrite`)
        continue // adopted as is
      }
      operations.push({ path: file.path, source, hadOriginal: exists })
    }
  }
  const kept = owners(next)
  for (const [file] of before) {
    if (!kept.has(file) && fs.lstatSync(path.join(root, file), { throwIfNoEntry: false })) operations.push({ path: file, hadOriginal: true })
  }
  return operations
}

function apply(root: string, backup: string, operation: Operation) {
  const destination = path.join(root, operation.path)
  if (operation.hadOriginal) {
    ensureDirectory(backup, path.dirname(operation.path))
    fs.renameSync(destination, path.join(backup, operation.path))
  }
  if (operation.source) {
    ensureDirectory(root, path.dirname(operation.path))
    fs.renameSync(operation.source, destination)
  }
}

// Walks up from each deleted file; packages do not always list their
// directories, and a directory another package still ships is never removed.
function removeEmptyDirectories(root: string, deleted: readonly string[], next: Database) {
  const kept = new Set(Object.values(next.packages).flatMap((record) => record.files.filter((file) => file.type === "directory").map((file) => file.path)))
  const candidates = new Set<string>()
  // A deleted path may itself be a directory an uninstalled package shipped empty.
  for (const file of deleted) {
    candidates.add(file)
    for (let directory = path.posix.dirname(file); directory !== "."; directory = path.posix.dirname(directory)) candidates.add(directory)
  }
  for (const directory of [...candidates].filter((entry) => !kept.has(entry)).sort((a, b) => b.length - a.length)) {
    const target = path.join(root, directory)
    if (fs.existsSync(target) && fs.readdirSync(target).length === 0) fs.rmdirSync(target)
  }
}

function finish(state: string, journal: Journal) {
  fs.rmSync(files(state).backup(journal.id), { recursive: true, force: true })
  fs.rmSync(files(state).journal, { force: true })
}

export function commitTransaction(
  root: string,
  state: string,
  current: Database,
  next: Database,
  staged: readonly StagedPackage[],
  hooks: TransactionHooks = {},
) {
  if (fs.existsSync(files(state).journal)) throw new TransactionError("an unfinished transaction must be recovered first")
  const operations = plan(root, current, next, staged)
  const journal: Journal = { id: `${Date.now()}-${process.pid}`, operations, previous: current, committed: false }
  writeAtomically(files(state).journal, journal)
  const backup = files(state).backup(journal.id)
  fs.mkdirSync(backup, { recursive: true })
  operations.forEach((operation, index) => {
    apply(root, backup, operation)
    hooks.afterOperation?.(index)
  })
  // Directories a package ships empty (etc/ssl/certs/java for java-cacerts) have no file to carry them in.
  for (const item of staged) {
    for (const file of item.record.files) if (file.type === "directory") ensureDirectory(root, file.path)
  }
  writeAtomically(files(state).database, next)
  writeAtomically(files(state).journal, { ...journal, committed: true })
  const nextDirectories = new Set(Object.values(next.packages).flatMap((record) => record.files.filter((file) => file.type === "directory").map((file) => file.path)))
  const droppedDirectories = Object.values(current.packages)
    .flatMap((record) => record.files.filter((file) => file.type === "directory").map((file) => file.path))
    .filter((directory) => !nextDirectories.has(directory))
  removeEmptyDirectories(root, [...operations.filter((operation) => !operation.source).map((operation) => operation.path), ...droppedDirectories], next)
  for (const item of staged) fs.rmSync(item.stagingDir, { recursive: true, force: true })
  finish(state, journal)
}

export function recoverTransaction(root: string, state: string): "none" | "rolled-back" | "completed" {
  if (!fs.existsSync(files(state).journal)) return "none"
  const journal = JSON.parse(fs.readFileSync(files(state).journal, "utf8")) as Journal
  if (journal.committed) {
    finish(state, journal)
    return "completed"
  }
  const backup = files(state).backup(journal.id)
  for (const operation of [...journal.operations].reverse()) {
    const destination = path.join(root, operation.path)
    const saved = path.join(backup, operation.path)
    if (operation.hadOriginal && fs.lstatSync(saved, { throwIfNoEntry: false })) {
      fs.rmSync(destination, { force: true })
      fs.renameSync(saved, destination)
    } else if (!operation.hadOriginal) fs.rmSync(destination, { force: true })
  }
  writeAtomically(files(state).database, journal.previous)
  finish(state, journal)
  return "rolled-back"
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function acquireLock(state: string): () => void {
  const lock = files(state).lock
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" })
      return () => fs.rmSync(lock, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const holder = Number(fs.readFileSync(lock, "utf8"))
      if (Number.isInteger(holder) && alive(holder)) throw new TransactionError(`toolchains are locked by process ${holder}`)
      fs.rmSync(lock, { force: true }) // the holder died without releasing
    }
  }
  throw new TransactionError("could not acquire the toolchain lock")
}
