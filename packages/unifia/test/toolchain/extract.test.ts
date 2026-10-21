// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/archive.ts, src/toolchain/tree.ts and src/toolchain/digest.ts.
 *
 * Archives are built with the real tar and zip binaries. Hostile archives (path escape,
 * absolute member, symlink) are real files, so the tests show what the extractor sees.
 */
import { expect, test } from "bun:test"
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { extract } from "../../src/toolchain/archive"
import { h1, sri512 } from "../../src/toolchain/digest"
import { walk } from "../../src/toolchain/tree"

async function run(cmd: string[], cwd?: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${cmd[0]} failed: ${await new Response(proc.stderr).text()}`)
}

// A package tree: pkg/bin/tool (executable) and pkg/README.md, packed as pkg/... in the archive.
async function packageTree(root: string) {
  await mkdir(path.join(root, "src", "pkg", "bin"), { recursive: true })
  await writeFile(path.join(root, "src", "pkg", "bin", "tool"), "#!/bin/sh\necho tool 1.0.0\n")
  await chmod(path.join(root, "src", "pkg", "bin", "tool"), 0o755)
  await writeFile(path.join(root, "src", "pkg", "README.md"), "hello\n")
}

test("extracts a tar.gz under its prefix and keeps the executable bit", async () => {
  await using tmp = await tmpdir()
  await packageTree(tmp.path)
  await run(["tar", "-czf", "pkg.tgz", "-C", "src", "pkg"], tmp.path)
  const dest = path.join(tmp.path, "out")
  const files = await extract(path.join(tmp.path, "pkg.tgz"), "tar.gz", "pkg", dest)
  expect(files.sort()).toEqual(["pkg/README.md", "pkg/bin/tool"])
  expect(await readFile(path.join(dest, "pkg", "README.md"), "utf8")).toBe("hello\n")
  expect((await Bun.file(path.join(dest, "pkg", "bin", "tool")).stat()).mode & 0o111).not.toBe(0)
})

test("refuses a member that escapes the destination with ..", async () => {
  // "../escape.txt" leaves the prefix; "pkg/../escape.txt" stays under it but still climbs out.
  for (const name of ["../escape.txt", "pkg/../escape.txt"]) {
    await using tmp = await tmpdir()
    await writeFile(path.join(tmp.path, "escape.txt"), "x")
    await run(["tar", "-cf", "evil.tar", "--transform", `s|^escape.txt|${name}|`, "escape.txt"], tmp.path)
    await run(["gzip", "-f", "evil.tar"], tmp.path)
    await expect(extract(path.join(tmp.path, "evil.tar.gz"), "tar.gz", "pkg", path.join(tmp.path, "out"))).rejects.toThrow(
      "unsafe archive member",
    )
    expect(await Bun.file(path.join(tmp.path, "escape.txt")).exists()).toBe(true)
  }
})

test("refuses an absolute member", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "abs.txt"), "x")
  await run(["tar", "-P", "-czf", "abs.tgz", path.join(tmp.path, "abs.txt")], tmp.path)
  await expect(extract(path.join(tmp.path, "abs.tgz"), "tar.gz", "pkg", path.join(tmp.path, "out"))).rejects.toThrow(
    "unsafe archive member",
  )
})

test("refuses a member outside the declared prefix", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src", "other"), { recursive: true })
  await writeFile(path.join(tmp.path, "src", "other", "x.txt"), "x")
  await run(["tar", "-czf", "other.tgz", "-C", "src", "other"], tmp.path)
  await expect(extract(path.join(tmp.path, "other.tgz"), "tar.gz", "pkg", path.join(tmp.path, "out"))).rejects.toThrow(
    "unsafe archive member",
  )
})

test("refuses a symlink in the extracted tree", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src", "pkg"), { recursive: true })
  await symlink("/etc/passwd", path.join(tmp.path, "src", "pkg", "leak"))
  await run(["tar", "-czf", "link.tgz", "-C", "src", "pkg"], tmp.path)
  await expect(extract(path.join(tmp.path, "link.tgz"), "tar.gz", "pkg", path.join(tmp.path, "out"))).rejects.toThrow(
    "unsafe archive member",
  )
})

test("extracts a zip archive under its prefix", async () => {
  if (!Bun.which("zip") || !Bun.which("unzip")) return
  await using tmp = await tmpdir()
  await packageTree(tmp.path)
  await run(["zip", "-qr", "pkg.zip", "pkg"], path.join(tmp.path, "src"))
  await run(["mv", path.join("src", "pkg.zip"), "pkg.zip"], tmp.path)
  const dest = path.join(tmp.path, "out")
  expect((await extract(path.join(tmp.path, "pkg.zip"), "zip", "pkg", dest)).sort()).toEqual([
    "pkg/README.md",
    "pkg/bin/tool",
  ])
})

test("walk lists regular files and refuses other file types", async () => {
  await using tmp = await tmpdir()
  await packageTree(tmp.path)
  expect((await walk(path.join(tmp.path, "src"))).sort()).toEqual(["pkg/README.md", "pkg/bin/tool"])
  await symlink("/etc", path.join(tmp.path, "src", "pkg", "link"))
  await expect(walk(path.join(tmp.path, "src"))).rejects.toThrow("unsafe archive member")
})

test("h1 matches the Go dirhash of a known tree", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg", "bin"), { recursive: true })
  await writeFile(path.join(tmp.path, "pkg", "a.txt"), "hello\n")
  await writeFile(path.join(tmp.path, "pkg", "bin", "tool"), "#!/bin/sh\necho x\n")
  // Reference computed independently from the Go dirhash definition (sorted "<sha256>  <name>\n" lines).
  expect(await h1(tmp.path)).toBe("h1:5Kqvd5HLLjOtwcjW1P4qUkIhs+9/I8oXBOEFp2rsOFg=")
})

test("sri512 encodes a file as an npm-style SRI string", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "empty"), "")
  expect(await sri512(path.join(tmp.path, "empty"))).toBe(
    "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==",
  )
})

test("walk accepts a relative symlink that stays inside the tree and leaves it out of the file list", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg", "lib"), { recursive: true })
  await mkdir(path.join(tmp.path, "pkg", "bin"), { recursive: true })
  await writeFile(path.join(tmp.path, "pkg", "lib", "cli.js"), "console.log(1)\n")
  await symlink("../lib/cli.js", path.join(tmp.path, "pkg", "bin", "cli"))
  expect(await walk(tmp.path)).toEqual(["pkg/lib/cli.js"])
})

test("walk refuses a relative symlink that climbs out of the tree", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg", "bin"), { recursive: true })
  await symlink("../../../etc/passwd", path.join(tmp.path, "pkg", "bin", "leak"))
  await expect(walk(tmp.path)).rejects.toThrow("unsafe archive member")
})

test("walk accepts a chain of links that stays inside the tree, as Debian sonames do", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg"), { recursive: true })
  await writeFile(path.join(tmp.path, "pkg", "lib.so.4.8.0"), "x")
  await symlink("lib.so.4.8.0", path.join(tmp.path, "pkg", "lib.so.4"))
  await symlink("lib.so.4", path.join(tmp.path, "pkg", "lib.so.3"))
  expect(await walk(tmp.path)).toEqual(["pkg/lib.so.4.8.0"])
})

test("walk refuses a chain of links that leaves the tree", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg"), { recursive: true })
  await symlink("../../../etc/passwd", path.join(tmp.path, "pkg", "hop"))
  await symlink("hop", path.join(tmp.path, "pkg", "chain"))
  await expect(walk(tmp.path)).rejects.toThrow("unsafe archive member")
})

test("walk refuses a loop of links", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg"), { recursive: true })
  await symlink("b", path.join(tmp.path, "pkg", "a"))
  await symlink("a", path.join(tmp.path, "pkg", "b"))
  await expect(walk(tmp.path)).rejects.toThrow("unsafe archive member")
})

test("extracts a tar.xz archive under its prefix", async () => {
  await using tmp = await tmpdir()
  await packageTree(tmp.path)
  await run(["tar", "-cJf", "pkg.tar.xz", "-C", "src", "pkg"], tmp.path)
  const files = await extract(path.join(tmp.path, "pkg.tar.xz"), "tar.xz", "pkg", path.join(tmp.path, "out"))
  expect(files.sort()).toEqual(["pkg/README.md", "pkg/bin/tool"])
})

test("walk accepts a dangling relative symlink that still points inside the tree", async () => {
  // Debian documentation links to a package that this install did not take: the target is absent, not outside.
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg", "doc", "a"), { recursive: true })
  await writeFile(path.join(tmp.path, "pkg", "doc", "real.txt"), "x")
  await symlink("../real.txt", path.join(tmp.path, "pkg", "doc", "a", "link"))
  await symlink("../../missing/doc", path.join(tmp.path, "pkg", "doc", "a", "gone"))
  expect(await walk(tmp.path)).toEqual(["pkg/doc/real.txt"])
})

test("walk refuses a relative symlink whose target path goes through another symlink", async () => {
  // alias is a directory link inside the tree; a target that climbs through it could land elsewhere.
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg", "real"), { recursive: true })
  await mkdir(path.join(tmp.path, "pkg", "sub"), { recursive: true })
  await symlink("real", path.join(tmp.path, "pkg", "alias"))
  await symlink("../alias/file", path.join(tmp.path, "pkg", "sub", "lnk"))
  await expect(walk(tmp.path)).rejects.toThrow("unsafe archive member")
})
