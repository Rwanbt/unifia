/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { ToolchainManager } from "../../src/toolchain/manager"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { FIXTURE_KEY, FIXTURE_REPO, type FixturePackage, repository } from "./repo-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))

const V1: FixturePackage[] = [
  { name: "musl", version: "1.2.5-r9", files: { "lib/ld-musl-aarch64.so.1": "musl" } },
  { name: "libfoo", version: "1.0-r0", depends: ["musl"], files: { "usr/lib/libfoo.so.1": "foo-1", "usr/share/foo/old": "o" } },
  { name: "python3", version: "3.12.15-r0", depends: ["libfoo>=1.0"], files: { "usr/bin/python3": "py" } },
  { name: "unrelated", version: "1-r0", files: { "usr/bin/unrelated": "u" } },
]
const V2 = V1.map((item) => (item.name === "libfoo" ? { ...item, version: "1.1-r0", files: { "usr/lib/libfoo.so.1": "foo-1.1" } } : item))

function setup(packages: FixturePackage[], quotaBytes = 1_000_000) {
  const base = fixtureDirSync("unifia-manager-")
  created.push(base)
  const served = { current: repository(packages) }
  const fetched: string[] = []
  const manager = new ToolchainManager({
    root: path.join(base, "rootfs"),
    state: path.join(base, "state"),
    arch: "aarch64",
    repositories: [FIXTURE_REPO],
    keys: [FIXTURE_KEY],
    quotaBytes,
    fetchBytes: async (url) => {
      fetched.push(url)
      const bytes = served.current.get(url)
      if (!bytes) throw new Error(`404 ${url}`)
      return bytes
    },
  })
  const read = (file: string) => fs.readFileSync(path.join(base, "rootfs", file), "utf8")
  return { manager, served, fetched, read, base }
}

test("install resolves, verifies and installs the closure, marking only the request as explicit", async () => {
  const { manager, read } = setup(V1)
  const summary = await manager.install(["python3"])
  expect(summary.installed).toEqual(["musl@1.2.5-r9", "libfoo@1.0-r0", "python3@3.12.15-r0"])
  expect(read("usr/bin/python3")).toBe("py")
  expect(manager.list().map((item) => [item.name, item.explicit])).toEqual([
    ["musl", false],
    ["libfoo", false],
    ["python3", true],
  ])
})

test("update upgrades a dependency in place and removes files it no longer ships", async () => {
  const { manager, served, read, base } = setup(V1)
  await manager.install(["python3"])
  served.current = repository(V2)
  const summary = await manager.update()
  expect(summary.installed).toEqual(["libfoo@1.1-r0"])
  expect(read("usr/lib/libfoo.so.1")).toBe("foo-1.1")
  expect(fs.existsSync(path.join(base, "rootfs/usr/share/foo/old"))).toBe(false)
})

test("rollback restores the previous versions from the verified cache without the network", async () => {
  const { manager, served, read } = setup(V1)
  await manager.install(["python3"])
  served.current = repository(V2)
  await manager.update()
  served.current = new Map()
  const summary = await manager.rollback()
  expect(summary.installed).toEqual(["libfoo@1.0-r0"])
  expect(read("usr/lib/libfoo.so.1")).toBe("foo-1")
  expect(read("usr/share/foo/old")).toBe("o")
})

// Seen on Alpine v3.20 -> v3.21: libbz2 1.0.8-r6 was rebuilt with the same version and new bytes.
test("rollback restores a rebuilt package that kept its version number", async () => {
  const { manager, served, read } = setup(V1)
  await manager.install(["python3"])
  served.current = repository(V1.map((item) => (item.name === "libfoo" ? { ...item, files: { ...item.files, "usr/lib/libfoo.so.1": "rebuilt" } } : item)))
  expect((await manager.update()).installed).toEqual(["libfoo@1.0-r0"])
  served.current = new Map()
  await manager.rollback()
  expect(read("usr/lib/libfoo.so.1")).toBe("foo-1")
})

// Alpine's `clang` and `openssh-client` are names other packages provide (clang19, ...).
test("a request by provided name survives update and can be removed by that name", async () => {
  const { manager, read } = setup([...V1, { name: "clang19", version: "19.1-r0", provides: ["clang=19.1-r0"], files: { "usr/bin/clang": "c" } }])
  await manager.install(["clang"])
  expect(manager.list().find((item) => item.name === "clang19")?.explicit).toBe(true)
  expect((await manager.update()).removed).toEqual([])
  expect(read("usr/bin/clang")).toBe("c")
  expect((await manager.remove(["clang"])).removed).toEqual(["clang19"])
})

test("remove uninstalls the request and the dependencies nothing else needs", async () => {
  const { manager, base } = setup(V1)
  await manager.install(["python3", "unrelated"])
  const summary = await manager.remove(["python3"])
  expect([...summary.removed].sort()).toEqual(["libfoo", "musl", "python3"])
  expect(manager.list().map((item) => item.name)).toEqual(["unrelated"])
  expect(fs.existsSync(path.join(base, "rootfs/usr/bin/python3"))).toBe(false)
  await expect(manager.remove(["libfoo"])).rejects.toThrow(/not explicitly installed/)
})

test("a tampered download is rejected and leaves no file, cache entry or database change", async () => {
  const { manager, served, base } = setup(V1)
  const url = `${FIXTURE_REPO}/aarch64/python3-3.12.15-r0.apk`
  const bytes = new Uint8Array(served.current.get(url)!)
  bytes[bytes.length - 20]! ^= 0xff
  served.current.set(url, bytes)
  await expect(manager.install(["python3"])).rejects.toThrow()
  expect(manager.list()).toEqual([])
  expect(fs.existsSync(path.join(base, "rootfs/usr/bin/python3"))).toBe(false)
  expect(fs.readdirSync(path.join(base, "state/cache")).filter((file) => file.startsWith("python3"))).toEqual([])
})

test("an install over the quota is refused before anything is downloaded", async () => {
  const { manager, fetched } = setup(V1, 5)
  await expect(manager.install(["python3"])).rejects.toThrow(/quota/)
  expect(fetched.filter((url) => url.endsWith(".apk"))).toEqual([])
})

test("environment exposes the rootfs binary directories on PATH", () => {
  const { manager, base } = setup(V1)
  expect(manager.environment().PATH.split(path.delimiter)[0]).toBe(path.join(base, "rootfs", "usr/bin"))
})
