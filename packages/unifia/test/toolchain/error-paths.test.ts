/* SPDX-License-Identifier: MIT */
// Error paths the coverage audit found unexercised (2026-10-22): each test
// drives one refusal and checks that nothing was left half-done.
import { afterEach, expect, test } from "bun:test"
import { NetworkAuthority } from "@unifia/network-authority"
import { generateKeyPairSync, sign } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { ArchiveError, extractEntries, readTar, splitGzipMembers } from "../../src/toolchain/archive"
import { authorizedFetchBytes } from "../../src/toolchain/download"
import { ToolchainManager } from "../../src/toolchain/manager"
import { compareVersions, loadIndex, parseIndex, RepositoryError, resolve, verifyPackage } from "../../src/toolchain/repository"
import { acquireLock, commitTransaction, emptyDatabase, readDatabase, recoverTransaction, type StagedPackage } from "../../src/toolchain/transaction"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { FIXTURE_KEY, FIXTURE_REPO, type FixturePackage, repository } from "./repo-fixture"
import { concat, gzip, tar } from "./tar-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))
const tempDir = () => created[created.push(fixtureDirSync("unifia-errors-")) - 1]!

// archive.ts
test("gzip members with FEXTRA, FNAME, FCOMMENT and FHCRC headers are split correctly", () => {
  const plain = gzip(new TextEncoder().encode("payload"))
  const extra = new Uint8Array([4, 0, 1, 2, 3, 4])
  const name = new TextEncoder().encode("name\0")
  const comment = new TextEncoder().encode("comment\0")
  const headerCrc = new Uint8Array([0, 0])
  const withFlags = concat(plain.subarray(0, 3), new Uint8Array([4 | 8 | 16 | 2]), plain.subarray(4, 10), extra, name, comment, headerCrc, plain.subarray(10))
  const [member] = splitGzipMembers(withFlags)
  expect(new TextDecoder().decode(member!.decompressed)).toBe("payload")
})

test("corrupt and truncated gzip members and tar members are ArchiveErrors", () => {
  const valid = gzip(new TextEncoder().encode("some data to compress"))
  const corrupt = valid.slice()
  corrupt[12] ^= 0xff
  expect(() => splitGzipMembers(corrupt)).toThrow(ArchiveError)
  expect(() => splitGzipMembers(valid.subarray(0, valid.length - 3))).toThrow(/truncated|corrupt/)
  const archive = tar([{ name: "file", data: "x".repeat(600) }], false)
  expect(() => readTar(archive.subarray(0, 700))).toThrow(/truncated tar member/)
})

test("malformed pax records and octal fields are ArchiveErrors", () => {
  expect(() => readTar(tar([{ name: "pax", type: "x", data: "garbage-without-length\n" }, { name: "f", data: "1" }]))).toThrow(/malformed pax/)
  expect(() => readTar(tar([{ name: "pax", type: "x", data: "12 noequals\n" }, { name: "f", data: "1" }]))).toThrow(/malformed pax/)
  const bad = tar([{ name: "f", data: "1" }])
  bad.set(new TextEncoder().encode("9z"), 124)
  expect(() => readTar(bad)).toThrow(ArchiveError)
})

test("a file where a directory is needed is refused", () => {
  const entries = readTar(tar([{ name: "usr", data: "file" }, { name: "usr/bin/tool", data: "t" }]))
  expect(() => extractEntries(entries, tempDir())).toThrow(/not a directory/)
})

// repository.ts
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const KEY = { name: "k.rsa.pub", pem: publicKey.export({ type: "spki", format: "pem" }).toString() }
const signedBy = (prefix: string, member: Uint8Array, algorithm = "sha1") =>
  concat(gzip(tar([{ name: `${prefix}${KEY.name}`, data: sign(algorithm, member, privateKey) }], false)), member)

test("an RSA256 signature is accepted, and a first member that is not a signature is refused", () => {
  const control = gzip(tar([{ name: "APKINDEX", data: "C:Q1x=\nP:a\nV:1-r0\nA:aarch64\nS:1\n" }]))
  expect(loadIndex(signedBy(".SIGN.RSA256.", control, "sha256"), [KEY]).map((entry) => entry.name)).toEqual(["a"])
  expect(() => loadIndex(concat(gzip(tar([{ name: "not-a-signature", data: "x" }], false)), control), [KEY])).toThrow(/not an apk signature/)
})

test("an index without APKINDEX, an entry without P: or V:, and an unparseable version are refused", () => {
  expect(() => loadIndex(signedBy(".SIGN.RSA.", gzip(tar([{ name: "DESCRIPTION", data: "x" }]))), [KEY])).toThrow(/no APKINDEX/)
  expect(() => parseIndex("V:1-r0\nA:aarch64\n")).toThrow(/without P: or V:/)
  expect(() => compareVersions("not a version", "1-r0")).toThrow(/unparseable version/)
})

test("version constraints <, <=, > and ~ follow apk ordering", () => {
  const index = (depends: string) => parseIndex(`C:Q1a=\nP:app\nV:1-r0\nA:aarch64\nS:1\nD:${depends}\n\nC:Q1b=\nP:lib\nV:1.5.2-r0\nA:aarch64\nS:1\n`)
  expect(resolve(index("lib<2 lib<=1.5.2-r0 lib>1.0 lib~1.5"), ["app"]).map((entry) => entry.name)).toEqual(["lib", "app"])
  for (const unmet of ["lib<1.5", "lib<=1.5.1", "lib>2", "lib~1.6"]) expect(() => resolve(index(unmet), ["app"])).toThrow(unmet)
})

test("a package of the wrong size is refused before it is parsed", () => {
  const [entry] = parseIndex("C:Q1x=\nP:a\nV:1-r0\nA:aarch64\nS:10\n")
  expect(() => verifyPackage(new Uint8Array(3), entry!, [KEY])).toThrow(RepositoryError)
})

// transaction.ts
function stage(state: string, name: string, files: Record<string, string>): StagedPackage {
  const dir = fs.mkdtempSync(path.join(state, `stage-${name}-`))
  const extracted = extractEntries(readTar(tar(Object.entries(files).map(([file, data]) => ({ name: file, data })))), dir)
  const [entry] = parseIndex(`C:Q1x=\nP:${name}\nV:1-r0\nA:aarch64\nS:1\nI:1\nL:MIT\n`)
  return { stagingDir: dir, record: { entry: entry!, apkSha256: "0".repeat(64), files: extracted, explicit: true } }
}

function rootAndState() {
  const base = tempDir()
  const root = path.join(base, "rootfs")
  const state = path.join(base, "state")
  fs.mkdirSync(root)
  fs.mkdirSync(state)
  return { root, state }
}

test("two packages shipping the same file in one change are refused before anything moves", () => {
  const { root, state } = rootAndState()
  const staged = [stage(state, "a", { "usr/bin/tool": "a" }), stage(state, "b", { "usr/bin/tool": "b" })]
  const next = { version: 1 as const, packages: { a: staged[0]!.record, b: staged[1]!.record } }
  expect(() => commitTransaction(root, state, emptyDatabase(), next, staged)).toThrow(/both ship/)
  expect(fs.readdirSync(root)).toEqual([])
  expect(fs.existsSync(path.join(state, "journal.json"))).toBe(false)
})

test("a pending journal blocks new changes, and a committed one is finished by recovery", () => {
  const { root, state } = rootAndState()
  fs.writeFileSync(path.join(state, "journal.json"), JSON.stringify({ id: "1", operations: [], previous: emptyDatabase(), committed: true }))
  fs.mkdirSync(path.join(state, "backup", "1"), { recursive: true })
  const staged = [stage(state, "a", { "usr/bin/a": "a" })]
  expect(() => commitTransaction(root, state, emptyDatabase(), { version: 1, packages: { a: staged[0]!.record } }, staged)).toThrow(/recovered first/)
  expect(recoverTransaction(root, state)).toBe("completed")
  expect(fs.existsSync(path.join(state, "journal.json"))).toBe(false)
  expect(fs.existsSync(path.join(state, "backup", "1"))).toBe(false)
  expect(readDatabase(state)).toEqual(emptyDatabase())
})

// manager.ts
const PACKAGES: FixturePackage[] = [{ name: "tool", version: "1-r0", files: { "usr/bin/tool": "v1" } }]

function manager(served: Map<string, Uint8Array>) {
  const base = tempDir()
  return {
    base,
    manager: new ToolchainManager({
      root: path.join(base, "rootfs"),
      state: path.join(base, "state"),
      arch: "aarch64",
      repositories: [FIXTURE_REPO],
      keys: [FIXTURE_KEY],
      quotaBytes: 1e9,
      fetchBytes: async (url) => served.get(url) ?? Promise.reject(new Error(`404 ${url}`)),
    }),
  }
}

test("rollback with no previous state is refused", async () => {
  await expect(manager(repository(PACKAGES)).manager.rollback()).rejects.toThrow(/no previous state/)
})

test("rollback refuses a cached package that was evicted or tampered with, and changes nothing", async () => {
  const served = repository(PACKAGES)
  const { manager: tools, base } = manager(served)
  await tools.install(["tool"])
  served.clear()
  for (const [url, bytes] of repository([{ ...PACKAGES[0]!, version: "2-r0", files: { "usr/bin/tool": "v2" } }])) served.set(url, bytes)
  await tools.update()
  const cache = path.join(base, "state", "cache")
  const cached = fs.readdirSync(cache).find((file) => file.startsWith("tool-1-r0"))!
  const bytes = fs.readFileSync(path.join(cache, cached))
  bytes[bytes.length - 5]! ^= 0xff
  fs.writeFileSync(path.join(cache, cached), bytes)
  await expect(tools.rollback()).rejects.toThrow()
  expect(fs.readFileSync(path.join(base, "rootfs/usr/bin/tool"), "utf8")).toBe("v2")
  fs.rmSync(path.join(cache, cached))
  await expect(tools.rollback()).rejects.toThrow(/no longer cached/)
})

test("a package whose files cannot be staged leaves no staging directory behind", async () => {
  const { manager: tools, base } = manager(repository([{ name: "bad", version: "1-r0", files: { usr: "a file", "usr/bin/x": "x" } }]))
  await expect(tools.install(["bad"])).rejects.toThrow(/not a directory/)
  expect(fs.readdirSync(path.join(base, "state")).filter((entry) => entry.startsWith("staging-"))).toEqual([])
  expect(tools.list()).toEqual([])
})

// download.ts
test("downloads refuse HTTP errors and streams over the size cap, and never follow redirects", async () => {
  const authority = new NetworkAuthority(async () => ["151.101.2.132"])
  const original = globalThis.fetch
  const seen: RequestInit[] = []
  try {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(init)
      return new Response("nope", { status: 404 })
    }) as unknown as typeof fetch
    await expect(authorizedFetchBytes(authority)("https://dl-cdn.alpinelinux.org/x")).rejects.toThrow(/HTTP 404/)
    expect(seen[0]!.redirect).toBe("error")
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as unknown as typeof fetch
    await expect(authorizedFetchBytes(authority, 10)("https://dl-cdn.alpinelinux.org/x")).rejects.toThrow(/larger than 10 bytes/)
    expect((await authorizedFetchBytes(authority, 100)("https://dl-cdn.alpinelinux.org/x")).length).toBe(100)
  } finally {
    globalThis.fetch = original
  }
})

// transaction.ts: a lock error other than "already held" must surface, never be swallowed.
test("a lock that cannot be created for another reason propagates the error", () => {
  expect(() => acquireLock(path.join(tempDir(), "missing", "state"))).toThrow(/ENOENT/)
})
