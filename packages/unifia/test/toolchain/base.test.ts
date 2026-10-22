/* SPDX-License-Identifier: MIT */
// The rootfs shipped in the APK already holds packages that apk installed at
// build time. Found on a real phone (2026-10-23): with an empty database the
// first install refused to touch musl. They are adopted as a pinned base.
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { parseInstalledDatabase } from "../../src/toolchain/base"
import { ToolchainManager } from "../../src/toolchain/manager"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { FIXTURE_KEY, FIXTURE_REPO, type FixturePackage, repository } from "./repo-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))

const INSTALLED = `C:Q1oldmusl=
P:musl
V:1.2.5-r8
A:aarch64
S:400000
I:700000
L:MIT
p:so:libc.musl-aarch64.so.1=1
F:lib
R:ld-musl-aarch64.so.1
Z:Q1aaaa=
R:libc.musl-aarch64.so.1

C:Q1oldgcc=
P:gcc
V:14.2.0-r4
A:aarch64
S:1
I:900000000
L:GPL-3.0-or-later
D:musl
F:usr/bin
R:gcc
`

const INDEX: FixturePackage[] = [
  { name: "musl", version: "1.2.5-r9", provides: ["so:libc.musl-aarch64.so.1=1"], files: { "lib/ld-musl-aarch64.so.1": "new musl" } },
  { name: "lua5.4", version: "5.4.7-r0", depends: ["so:libc.musl-aarch64.so.1"], files: { "usr/bin/lua5.4": "lua" } },
]

function shippedRootfs() {
  const base = fixtureDirSync("unifia-base-")
  created.push(base)
  const root = path.join(base, "rootfs")
  for (const [file, content] of Object.entries({ "lib/ld-musl-aarch64.so.1": "old musl", "lib/libc.musl-aarch64.so.1": "old libc", "usr/bin/gcc": "gcc" })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  fs.mkdirSync(path.join(root, "lib/apk/db"), { recursive: true })
  fs.writeFileSync(path.join(root, "lib/apk/db/installed"), INSTALLED)
  const served = repository(INDEX)
  const manager = new ToolchainManager({
    root,
    state: path.join(base, "state"),
    arch: "aarch64",
    repositories: [FIXTURE_REPO],
    keys: [FIXTURE_KEY],
    quotaBytes: 1_000_000,
    fetchBytes: async (url) => served.get(url) ?? Promise.reject(new Error(`404 ${url}`)),
  })
  return { root, manager }
}

test("the apk database is read with each package's files", () => {
  const [musl, gcc] = parseInstalledDatabase(INSTALLED)
  expect(musl!.entry).toMatchObject({ name: "musl", version: "1.2.5-r8", checksum: "Q1oldmusl=", provides: ["so:libc.musl-aarch64.so.1=1"] })
  expect(musl!.files.map((file) => file.path)).toEqual(["lib", "lib/ld-musl-aarch64.so.1", "lib/libc.musl-aarch64.so.1"])
  expect(gcc!.entry.depends).toEqual(["musl"])
})

test("packages the rootfs shipped with are adopted, listed and never counted against the quota", () => {
  const { manager } = shippedRootfs()
  expect(manager.list().map((item) => `${item.name}@${item.version}`)).toEqual(["musl@1.2.5-r8", "gcc@14.2.0-r4"])
})

test("installing over the shipped base reuses its musl and keeps every base package", async () => {
  const { root, manager } = shippedRootfs()
  const summary = await manager.install(["lua5.4"])
  expect(summary).toEqual({ installed: ["lua5.4@5.4.7-r0"], removed: [] })
  expect(fs.readFileSync(path.join(root, "lib/ld-musl-aarch64.so.1"), "utf8")).toBe("old musl")
  expect(fs.readFileSync(path.join(root, "usr/bin/gcc"), "utf8")).toBe("gcc")
  expect(manager.list().map((item) => item.name).sort()).toEqual(["gcc", "lua5.4", "musl"])
  await manager.remove(["lua5.4"])
  expect(fs.existsSync(path.join(root, "usr/bin/gcc"))).toBe(true)
  expect(fs.existsSync(path.join(root, "usr/bin/lua5.4"))).toBe(false)
})
