/* SPDX-License-Identifier: MIT */
// Found on a real phone (2026-10-27): dotnet8-sdk needs icu-data-full, the rootfs
// ships icu-data-en, and both provide icu-data=74.2-r1 with the same data file.
// apk replaces one with the other; the manager refused because the base was pinned.
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { ToolchainManager } from "../../src/toolchain/manager"
import { type IndexPackage, loadIndex } from "../../src/toolchain/repository"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { FIXTURE_KEY, FIXTURE_REPO, type FixturePackage, repository } from "./repo-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))

const DATA = "usr/share/icu/74.2/icudt74l.dat"
const EN: FixturePackage = { name: "icu-data-en", version: "74.2-r1", provides: ["icu-data=74.2-r1"], files: { [DATA]: "en", "usr/share/icu/en-only": "e" } }
const FULL: FixturePackage = { name: "icu-data-full", version: "74.2-r1", provides: ["icu-data=74.2-r1"], files: { [DATA]: "full" } }
const DOTNET: FixturePackage = { name: "dotnet8-runtime", version: "8.0.27-r0", depends: ["icu-data-full"], files: { "usr/lib/dotnet/dotnet": "dn" } }

function installedStanza(entry: IndexPackage, files: Record<string, string>): string {
  const lines = [`C:${entry.checksum}`, `P:${entry.name}`, `V:${entry.version}`, "A:aarch64", `S:${entry.size}`, `I:${entry.installedSize}`, "L:MIT", `p:${entry.provides.join(" ")}`]
  for (const file of Object.keys(files)) lines.push(`F:${path.posix.dirname(file)}`, `R:${path.posix.basename(file)}`)
  return `${lines.join("\n")}\n`
}

function rootfsWithEnglishIcu(published: FixturePackage[]) {
  const base = fixtureDirSync("unifia-replace-")
  created.push(base)
  const root = path.join(base, "rootfs")
  const served = { current: repository(published) }
  const index = loadIndex(served.current.get(`${FIXTURE_REPO}/aarch64/APKINDEX.tar.gz`)!, [FIXTURE_KEY])
  for (const [file, content] of Object.entries(EN.files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  fs.mkdirSync(path.join(root, "lib/apk/db"), { recursive: true })
  fs.writeFileSync(path.join(root, "lib/apk/db/installed"), installedStanza(index.find((entry) => entry.name === EN.name)!, EN.files))
  const options = {
    root,
    state: path.join(base, "state"),
    arch: "aarch64" as const,
    repositories: [FIXTURE_REPO],
    keys: [FIXTURE_KEY],
    quotaBytes: 1_000_000,
    fetchBytes: async (url: string) => served.current.get(url) ?? Promise.reject(new Error(`404 ${url}`)),
  }
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")
  return { root, served, read, manager: new ToolchainManager(options), reopen: () => new ToolchainManager(options) }
}

test("a package providing the same versioned name replaces the base package, as apk does", async () => {
  const { root, read, manager } = rootfsWithEnglishIcu([EN, FULL, DOTNET])
  const summary = await manager.install(["dotnet8-runtime"])
  expect(summary).toEqual({ installed: ["icu-data-full@74.2-r1", "dotnet8-runtime@8.0.27-r0"], removed: ["icu-data-en"] })
  expect(read(DATA)).toBe("full")
  expect(fs.existsSync(path.join(root, "usr/share/icu/en-only"))).toBe(false)
  expect(manager.list().map((item) => item.name).sort()).toEqual(["dotnet8-runtime", "icu-data-full"])
})

test("the replacement survives a restart although the rootfs apk database still lists the base package", async () => {
  const { manager, reopen } = rootfsWithEnglishIcu([EN, FULL, DOTNET])
  await manager.install(["dotnet8-runtime"])
  expect(reopen().list().map((item) => item.name).sort()).toEqual(["dotnet8-runtime", "icu-data-full"])
})

test("rolling back restores the replaced base package from the cache, offline", async () => {
  const { root, served, read, manager } = rootfsWithEnglishIcu([EN, FULL, DOTNET])
  await manager.install(["dotnet8-runtime"])
  served.current = new Map()
  const summary = await manager.rollback()
  expect(summary.installed).toEqual(["icu-data-en@74.2-r1"])
  expect(read(DATA)).toBe("en")
  expect(read("usr/share/icu/en-only")).toBe("e")
  expect(fs.existsSync(path.join(root, "usr/lib/dotnet/dotnet"))).toBe(false)
  expect(manager.list().map((item) => item.name)).toEqual(["icu-data-en"])
})

test("a base package that is no longer published is not replaced, since the change could not be rolled back", async () => {
  const { served, read, manager } = rootfsWithEnglishIcu([EN, FULL, DOTNET])
  served.current = repository([FULL, DOTNET])
  await expect(manager.install(["dotnet8-runtime"])).rejects.toThrow("icu-data-en-74.2-r1 is no longer published")
  expect(read(DATA)).toBe("en")
  expect(manager.list().map((item) => item.name)).toEqual(["icu-data-en"])
})
