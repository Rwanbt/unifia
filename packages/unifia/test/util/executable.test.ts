import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { trusted } from "../../src/util/executable"
import { tmpdir } from "../fixture/fixture"

describe("util.executable", () => {
  test("canonicalises a real program path", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "tool")
    await Bun.write(file, "")

    expect(trusted(file)).toBe(await fs.realpath(file))
  })

  test("leaves a bare program name to the operating system", () => {
    expect(trusted("rg")).toBe("rg")
  })

  test("leaves a missing absolute path so spawn still reports ENOENT", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "missing")

    expect(trusted(file)).toBe(file)
  })

  test("refuses an empty program", () => {
    expect(() => trusted("")).toThrow(/Program is required/)
  })

  test("refuses a null byte", () => {
    expect(() => trusted("/bin/sh\0x")).toThrow(/null byte/)
  })

  test("refuses a directory", async () => {
    await using tmp = await tmpdir()

    expect(() => trusted(tmp.path)).toThrow(/Not a regular file/)
  })

  test.skipIf(process.platform === "win32")("resolves a symlink to its target", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "target")
    const link = path.join(tmp.path, "link")
    await Bun.write(target, "")
    await fs.symlink(target, link)

    expect(trusted(link)).toBe(await fs.realpath(target))
  })

  test.skipIf(process.platform === "win32")("refuses a program in a world-writable directory", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "open")
    await fs.mkdir(dir)
    await Bun.write(path.join(dir, "tool"), "")
    await fs.chmod(dir, 0o777)

    expect(() => trusted(path.join(dir, "tool"))).toThrow(/world-writable/)
  })

  test.skipIf(process.platform === "win32")("allows a program in a sticky directory", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "shared")
    await fs.mkdir(dir)
    const file = path.join(dir, "tool")
    await Bun.write(file, "")
    await fs.chmod(dir, 0o1777)

    expect(trusted(file)).toBe(await fs.realpath(file))
  })
})
