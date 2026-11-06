/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { readTar } from "../../src/toolchain/archive"
import { applyLayer, resolveInRoot } from "../../src/container/layer"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { tar } from "../toolchain/tar-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))
const tempDir = () => created[created.push(fixtureDirSync("unifia-layer-")) - 1]!
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8")
const unix = process.platform !== "win32"

test("a later layer overrides files and adds new ones", () => {
  const root = tempDir()
  applyLayer(readTar(tar([{ name: "etc/os-release", data: "v1" }, { name: "etc/keep", data: "k" }])), root)
  applyLayer(readTar(tar([{ name: "etc/os-release", data: "v2" }, { name: "usr/bin/tool", data: "t", mode: 0o755 }])), root)
  expect([read(root, "etc/os-release"), read(root, "etc/keep"), read(root, "usr/bin/tool")]).toEqual(["v2", "k", "t"])
})

test("a whiteout deletes the entry from lower layers, files and directories alike", () => {
  const root = tempDir()
  applyLayer(readTar(tar([{ name: "etc/a", data: "a" }, { name: "var/cache/x/y", data: "y" }])), root)
  applyLayer(readTar(tar([{ name: "etc/.wh.a" }, { name: "var/cache/.wh.x" }])), root)
  expect(fs.existsSync(path.join(root, "etc/a"))).toBe(false)
  expect(fs.existsSync(path.join(root, "var/cache/x"))).toBe(false)
  expect(fs.existsSync(path.join(root, "etc/.wh.a"))).toBe(false)
})

test("an opaque whiteout empties the directory before the layer adds its own content", () => {
  const root = tempDir()
  applyLayer(readTar(tar([{ name: "app/old1", data: "1" }, { name: "app/old2", data: "2" }])), root)
  applyLayer(readTar(tar([{ name: "app/.wh..wh..opq" }, { name: "app/new", data: "n" }])), root)
  expect(fs.readdirSync(path.join(root, "app"))).toEqual(["new"])
})

test("hardlinks are copied from the layer or from a lower layer", () => {
  const root = tempDir()
  applyLayer(readTar(tar([{ name: "usr/bin/python3.12", data: "py" }])), root)
  applyLayer(readTar(tar([{ name: "usr/bin/python3", type: "1", linkname: "usr/bin/python3.12" }])), root)
  expect(read(root, "usr/bin/python3")).toBe("py")
})

test.skipIf(!unix)("paths go through symlinked directories inside the root, never outside it", () => {
  const root = tempDir()
  const outside = tempDir()
  applyLayer(readTar(tar([{ name: "usr/bin/", type: "5" }, { name: "bin", type: "2", linkname: "usr/bin" }, { name: "escape", type: "2", linkname: outside }])), root)
  applyLayer(readTar(tar([{ name: "bin/sh", data: "shell" }, { name: "escape/pwned", data: "x" }])), root)
  expect(read(root, "usr/bin/sh")).toBe("shell")
  expect(fs.readdirSync(outside)).toEqual([])
  expect(read(root, path.join(outside.replace(/^\//, ""), "pwned"))).toBe("x")
})

test.skipIf(!unix)("a hardlink whose source is a symlink to a host file copies nothing", () => {
  const root = tempDir()
  const secret = path.join(tempDir(), "secret")
  fs.writeFileSync(secret, "host secret")
  fs.mkdirSync(path.join(root, "usr/bin"), { recursive: true })
  fs.symlinkSync(secret, path.join(root, "usr/bin/real"))
  // Absolute links resolve inside the root, so only a relative escape reaches the host.
  fs.rmSync(path.join(root, "usr/bin/real"))
  fs.symlinkSync(path.relative(path.join(root, "usr/bin"), secret), path.join(root, "usr/bin/real"))
  expect(() => applyLayer(readTar(tar([{ name: "usr/bin/copy", type: "1", linkname: "usr/bin/real" }])), root)).toThrow(/no file to copy/)
  expect(fs.existsSync(path.join(root, "usr/bin/copy"))).toBe(false)
})

test.skipIf(!unix)("resolveInRoot clamps .. and absolute links at the container root", () => {
  const root = tempDir()
  fs.mkdirSync(path.join(root, "etc"))
  fs.symlinkSync("/../../../etc", path.join(root, "up"))
  expect(resolveInRoot(root, "up/passwd")).toBe(path.join(root, "etc/passwd"))
  expect(resolveInRoot(root, "a/../../../b")).toBe(path.join(root, "b"))
})

test.skipIf(!unix)("a symlink loop is refused instead of hanging", () => {
  const root = tempDir()
  fs.symlinkSync("b", path.join(root, "a"))
  fs.symlinkSync("a", path.join(root, "b"))
  expect(() => resolveInRoot(root, "a/x")).toThrow(/too many/)
})
