/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { type ExtractedFile, extractEntries, readTar } from "../../src/toolchain/archive"
import { parseIndex } from "../../src/toolchain/repository"
import {
  type Database,
  type StagedPackage,
  TransactionError,
  acquireLock,
  commitTransaction,
  emptyDatabase,
  readDatabase,
  recoverTransaction,
} from "../../src/toolchain/transaction"
import { tar } from "./tar-fixture"

const created: string[] = []
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => created[created.push(fs.mkdtempSync(path.join(os.tmpdir(), "unifia-tx-"))) - 1]!

function setup() {
  const base = tempDir()
  const root = path.join(base, "rootfs")
  const state = path.join(base, "state")
  fs.mkdirSync(root)
  fs.mkdirSync(state)
  return { root, state }
}

function stage(state: string, name: string, version: string, files: Record<string, string>): StagedPackage {
  const dir = fs.mkdtempSync(path.join(state, `stage-${name}-`))
  const extracted: ExtractedFile[] = extractEntries(readTar(tar(Object.entries(files).map(([file, data]) => ({ name: file, data })))), dir)
  const [entry] = parseIndex(`C:Q1x=\nP:${name}\nV:${version}\nA:aarch64\nS:1\nI:1\nL:MIT\n`)
  return { stagingDir: dir, record: { entry: entry!, apkSha256: "0".repeat(64), files: extracted, explicit: true } }
}

function next(current: Database, staged: StagedPackage[], removed: string[] = []): Database {
  const packages = { ...current.packages }
  for (const name of removed) delete packages[name]
  for (const item of staged) packages[item.record.entry.name] = item.record
  return { ...current, packages }
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8")

test("commitTransaction installs files and records them in the database", () => {
  const { root, state } = setup()
  const staged = [stage(state, "python3", "3.12.15-r0", { "usr/bin/python3": "v1", "usr/lib/python3.12/os.py": "os" })]
  commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), staged), staged)
  expect(read(root, "usr/bin/python3")).toBe("v1")
  expect(Object.keys(readDatabase(state).packages)).toEqual(["python3"])
  expect(fs.existsSync(path.join(state, "journal.json"))).toBe(false)
  expect(fs.existsSync(staged[0]!.stagingDir)).toBe(false)
})

test("installing a second package leaves the first one's files in place", () => {
  const { root, state } = setup()
  const first = [stage(state, "git", "2.0-r0", { "usr/bin/git": "git" })]
  commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), first), first)
  const second = [stage(state, "go", "1.23-r0", { "usr/bin/go": "go" })]
  commitTransaction(root, state, readDatabase(state), next(readDatabase(state), second), second)
  expect([read(root, "usr/bin/git"), read(root, "usr/bin/go")]).toEqual(["git", "go"])
})

test("an upgrade replaces files and deletes those the new version no longer ships", () => {
  const { root, state } = setup()
  const first = [stage(state, "tool", "1.0-r0", { "usr/bin/tool": "v1", "usr/share/tool/old": "old" })]
  commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), first), first)
  const second = [stage(state, "tool", "2.0-r0", { "usr/bin/tool": "v2" })]
  commitTransaction(root, state, readDatabase(state), next(readDatabase(state), second), second)
  expect(read(root, "usr/bin/tool")).toBe("v2")
  expect(fs.existsSync(path.join(root, "usr/share/tool/old"))).toBe(false)
  expect(readDatabase(state).packages.tool!.entry.version).toBe("2.0-r0")
})

test("removing a package deletes its files and its now-empty directories", () => {
  const { root, state } = setup()
  const staged = [stage(state, "tool", "1.0-r0", { "usr/share/tool/data": "d" })]
  commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), staged), staged)
  commitTransaction(root, state, readDatabase(state), next(readDatabase(state), [], ["tool"]), [])
  expect(fs.existsSync(path.join(root, "usr/share/tool"))).toBe(false)
  expect(readDatabase(state).packages).toEqual({})
})

test("a file owned by another installed package is a conflict and changes nothing", () => {
  const { root, state } = setup()
  const first = [stage(state, "busybox", "1.0-r0", { "bin/sh": "busybox" })]
  commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), first), first)
  const clash = [stage(state, "bash", "5.0-r0", { "bin/sh": "bash", "bin/bash": "bash" })]
  expect(() => commitTransaction(root, state, readDatabase(state), next(readDatabase(state), clash), clash)).toThrow(/bin\/sh/)
  expect(read(root, "bin/sh")).toBe("busybox")
  expect(fs.existsSync(path.join(root, "bin/bash"))).toBe(false)
})

test("an unmanaged file is adopted only when identical, never overwritten", () => {
  const { root, state } = setup()
  fs.mkdirSync(path.join(root, "usr/bin"), { recursive: true })
  fs.writeFileSync(path.join(root, "usr/bin/same"), "x")
  fs.writeFileSync(path.join(root, "usr/bin/other"), "shipped by the APK rootfs")
  const same = [stage(state, "same", "1-r0", { "usr/bin/same": "x" })]
  commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), same), same)
  const other = [stage(state, "other", "1-r0", { "usr/bin/other": "replacement" })]
  expect(() => commitTransaction(root, state, readDatabase(state), next(readDatabase(state), other), other)).toThrow(/unmanaged/)
  expect(read(root, "usr/bin/other")).toBe("shipped by the APK rootfs")
})

test("a crash in the middle of an upgrade is rolled back by recoverTransaction", () => {
  const { root, state } = setup()
  const first = [stage(state, "tool", "1.0-r0", { "usr/bin/a": "a1", "usr/bin/b": "b1", "usr/bin/gone": "g" })]
  commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), first), first)
  const second = [stage(state, "tool", "2.0-r0", { "usr/bin/a": "a2", "usr/bin/b": "b2", "usr/bin/new": "n" })]
  const crash = { afterOperation: (index: number) => { if (index === 2) throw new Error("power loss") } }
  expect(() => commitTransaction(root, state, readDatabase(state), next(readDatabase(state), second), second, crash)).toThrow("power loss")
  expect(fs.existsSync(path.join(state, "journal.json"))).toBe(true)
  expect(recoverTransaction(root, state)).toBe("rolled-back")
  expect([read(root, "usr/bin/a"), read(root, "usr/bin/b"), read(root, "usr/bin/gone")]).toEqual(["a1", "b1", "g"])
  expect(fs.existsSync(path.join(root, "usr/bin/new"))).toBe(false)
  expect(readDatabase(state).packages.tool!.entry.version).toBe("1.0-r0")
  expect(recoverTransaction(root, state)).toBe("none")
})

test.skipIf(process.platform === "win32")("commitTransaction refuses a root directory that is a symlink", () => {
  const { root, state } = setup()
  const outside = tempDir()
  fs.symlinkSync(outside, path.join(root, "usr"))
  const staged = [stage(state, "tool", "1-r0", { "usr/bin/tool": "x" })]
  expect(() => commitTransaction(root, state, emptyDatabase(), next(emptyDatabase(), staged), staged)).toThrow(TransactionError)
  expect(fs.readdirSync(outside)).toEqual([])
})

test("acquireLock refuses a second holder while the first is alive and releases cleanly", () => {
  const { state } = setup()
  const release = acquireLock(state)
  expect(() => acquireLock(state)).toThrow(/locked/)
  release()
  acquireLock(state)()
})
