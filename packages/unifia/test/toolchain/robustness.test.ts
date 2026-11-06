/* SPDX-License-Identifier: MIT */
// Deterministic robustness checks run before any device test: a crash after
// every single file move, seeded fuzzing of the archive reader, and two real
// processes contending for the same rootfs.
import { afterEach, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { ArchiveError, extractEntries, readTar, splitGzipMembers } from "../../src/toolchain/archive"
import { parseIndex } from "../../src/toolchain/repository"
import { acquireLock, commitTransaction, type Database, emptyDatabase, readDatabase, recoverTransaction, type StagedPackage } from "../../src/toolchain/transaction"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { concat, gzip, paxRecord, tar } from "./tar-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))
const tempDir = () => created[created.push(fixtureDirSync("unifia-robust-")) - 1]!

function stage(state: string, name: string, version: string, files: Record<string, string>): StagedPackage {
  const dir = fs.mkdtempSync(path.join(state, `stage-${name}-`))
  const extracted = extractEntries(readTar(tar(Object.entries(files).map(([file, data]) => ({ name: file, data })))), dir)
  const [entry] = parseIndex(`C:Q1x=\nP:${name}\nV:${version}\nA:aarch64\nS:1\nI:1\nL:MIT\n`)
  return { stagingDir: dir, record: { entry: entry!, apkSha256: "0".repeat(64), files: extracted, explicit: true } }
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out[path.relative(root, full).replaceAll("\\", "/")] = fs.readFileSync(full, "utf8")
    }
  }
  walk(root)
  return out
}

test("a crash after any single file move is fully undone by recovery", () => {
  let operationsSeen = 0
  for (let crashAt = 0; ; crashAt++) {
    const base = tempDir()
    const root = path.join(base, "rootfs")
    const state = path.join(base, "state")
    fs.mkdirSync(root)
    fs.mkdirSync(state)
    const v1 = [stage(state, "tool", "1-r0", { "usr/bin/a": "a1", "usr/bin/b": "b1", "usr/share/gone": "g" }), stage(state, "old", "1-r0", { "usr/bin/old": "o" })]
    const first: Database = { version: 1, packages: Object.fromEntries(v1.map((item) => [item.record.entry.name, item.record])) }
    commitTransaction(root, state, emptyDatabase(), first, v1)
    const before = { files: snapshot(root), database: readDatabase(state) }
    const v2 = [stage(state, "tool", "2-r0", { "usr/bin/a": "a2", "usr/bin/b": "b2", "usr/bin/new": "n" })]
    const next: Database = { version: 1, packages: { tool: v2[0]!.record } }
    let crashed = false
    try {
      commitTransaction(root, state, readDatabase(state), next, v2, {
        afterOperation: (index) => {
          operationsSeen = Math.max(operationsSeen, index + 1)
          if (index === crashAt) {
            crashed = true
            throw new Error("power loss")
          }
        },
      })
    } catch (error) {
      expect(String(error)).toContain("power loss")
    }
    if (!crashed) break
    expect(recoverTransaction(root, state)).toBe("rolled-back")
    expect({ files: snapshot(root), database: readDatabase(state) }).toEqual(before)
  }
  expect(operationsSeen).toBeGreaterThanOrEqual(5)
})

// mulberry32: a fixed seed makes every run see the same corrupted inputs.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test("corrupted archives fail with ArchiveError and never write outside staging", () => {
  const valid = concat(
    gzip(tar([{ name: ".SIGN.RSA.key.rsa.pub", data: "sig" }], false)),
    gzip(
      tar([
        { name: "PaxHeader", type: "x", data: paxRecord("path", "usr/share/doc/Főtanúsítvány.txt") },
        { name: "x", data: "doc" },
        { name: "usr/bin/", type: "5" },
        { name: "usr/bin/tool", data: "#!/bin/sh\necho hi\n", mode: 0o755 },
        { name: "usr/bin/alias", type: "2", linkname: "tool" },
        { name: "usr/bin/copy", type: "1", linkname: "usr/bin/tool" },
      ]),
    ),
  )
  const sentinel = tempDir()
  const next = random(0x5eed)
  let rejected = 0
  for (let round = 0; round < 400; round++) {
    const bytes = valid.slice(0, round % 7 === 0 ? Math.floor(next() * valid.length) : valid.length)
    for (let flips = 1 + Math.floor(next() * 6); flips > 0; flips--) bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * 256)
    const staging = path.join(tempDir(), "staging")
    fs.mkdirSync(staging)
    try {
      for (const member of splitGzipMembers(bytes)) extractEntries(readTar(member.decompressed), fs.mkdtempSync(path.join(staging, "m-")))
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw new Error(`round ${round}: ${String(error)}`)
      rejected++
    }
    expect(fs.readdirSync(sentinel)).toEqual([])
  }
  expect(rejected).toBeGreaterThan(100)
})

test("a second process cannot take the lock while the first holds it, and takes it once the holder dies", async () => {
  const state = tempDir()
  const lockModule = path.resolve(import.meta.dir, "../../src/toolchain/transaction.ts")
  const holder = spawn(process.execPath, ["-e", `require(${JSON.stringify(lockModule)}).acquireLock(${JSON.stringify(state)}); console.log("held"); setInterval(() => {}, 1000)`], { stdio: ["ignore", "pipe", "inherit"] })
  await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()))
  expect(() => acquireLock(state)).toThrow(new RegExp(`locked by process ${holder.pid}`))
  holder.kill("SIGKILL")
  await new Promise((resolve) => holder.once("exit", resolve))
  const release = acquireLock(state)
  release()
})
