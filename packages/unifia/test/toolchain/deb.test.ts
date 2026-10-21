// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/deb.ts. A .deb is built here with the real ar, tar and zstd binaries, in
 * the layout Debian ships: debian-binary, control and data members, with paths starting "./".
 */
import { expect, test } from "bun:test"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { unpackDeb } from "../../src/toolchain/deb"

async function run(cmd: string[], cwd: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${cmd[0]} failed: ${await new Response(proc.stderr).text()}`)
}

// Packs `paths` (relative to src) into data.tar.zst and wraps it as a .deb named `name`.
async function deb(dir: string, name: string, paths: string[], tarArgs: string[] = []) {
  await writeFile(path.join(dir, "debian-binary"), "2.0\n")
  await run(["tar", ...tarArgs, "-cf", "data.tar", "-C", path.join(dir, "src"), ...paths], dir)
  await run(["zstd", "-q", "-f", "data.tar"], dir)
  await run(["ar", "rcs", name, "debian-binary", "data.tar.zst"], dir)
  return path.join(dir, name)
}

test("unpacks the data member of a Debian package with paths under ./", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src", "usr", "bin"), { recursive: true })
  await mkdir(path.join(tmp.path, "src", "usr", "lib"), { recursive: true })
  await writeFile(path.join(tmp.path, "src", "usr", "bin", "tool"), "#!/bin/sh\n")
  await writeFile(path.join(tmp.path, "src", "usr", "lib", "libtool.so.1"), "x")
  await symlink("libtool.so.1", path.join(tmp.path, "src", "usr", "lib", "libtool.so"))
  const file = await deb(tmp.path, "tool_1.0_arm64.deb", ["./usr"])
  const dest = path.join(tmp.path, "out")
  const { files } = await unpackDeb(file, dest)
  expect(files.sort()).toEqual(["usr/bin/tool", "usr/lib/libtool.so.1"])
  expect(await readFile(path.join(dest, "usr", "bin", "tool"), "utf8")).toBe("#!/bin/sh\n")
  expect(await Bun.file(path.join(dest, "usr", "lib", "libtool.so")).exists()).toBe(true)
})

test("refuses a package whose data member climbs out of the install root", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"), { recursive: true })
  await writeFile(path.join(tmp.path, "src", "x"), "x")
  const file = await deb(tmp.path, "evil_1.0_arm64.deb", ["x"], ["--transform", "s|^x|../escape|"])
  await expect(unpackDeb(file, path.join(tmp.path, "out"))).rejects.toThrow("unsafe archive member")
})

test("drops an absolute symlink from a package and reports it, instead of following it to the host", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src", "etc"), { recursive: true })
  await mkdir(path.join(tmp.path, "src", "usr", "bin"), { recursive: true })
  await writeFile(path.join(tmp.path, "src", "usr", "bin", "tool"), "#!/bin/sh\n")
  await symlink("/usr/sbin/rmt", path.join(tmp.path, "src", "etc", "rmt"))
  const file = await deb(tmp.path, "tar_1.35_arm64.deb", ["./usr", "./etc"])
  const dest = path.join(tmp.path, "out")
  const { files, absolute } = await unpackDeb(file, dest)
  expect(absolute).toEqual([{ link: "etc/rmt", target: "/usr/sbin/rmt" }])
  expect(files).toEqual(["usr/bin/tool"])
  expect(await Bun.file(path.join(dest, "etc", "rmt")).exists()).toBe(false)
})
