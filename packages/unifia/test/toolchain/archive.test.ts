/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { ArchiveError, extractEntries, readTar, safeRelativePath, splitGzipMembers } from "../../src/toolchain/archive"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { concat, gzip, paxRecord, tar } from "./tar-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))
const tempDir = () => created[created.push(fixtureDirSync("unifia-archive-")) - 1]!

test("splitGzipMembers returns each member's compressed bytes in order", () => {
  const first = gzip(new TextEncoder().encode("signature"))
  const second = gzip(new TextEncoder().encode("control"))
  const third = gzip(new TextEncoder().encode("data"))
  const members = splitGzipMembers(concat(first, second, third))
  expect(members.map((member) => member.compressed.length)).toEqual([first.length, second.length, third.length])
  expect(new TextDecoder().decode(members[1]!.decompressed)).toBe("control")
})

test("splitGzipMembers rejects bytes that are not gzip", () => {
  expect(() => splitGzipMembers(new TextEncoder().encode("not gzip at all"))).toThrow(ArchiveError)
})

test("readTar reads files, directories and symlinks, with or without end blocks", () => {
  const archive = [
    { name: "usr/", type: "5" as const, mode: 0o755 },
    { name: "usr/bin/tool", data: "#!/bin/sh\n", mode: 0o755 },
    { name: "usr/bin/alias", type: "2" as const, linkname: "tool" },
  ]
  for (const endBlocks of [true, false]) {
    const entries = readTar(tar(archive, endBlocks))
    expect(entries.map((entry) => [entry.path, entry.type])).toEqual([
      ["usr", "directory"],
      ["usr/bin/tool", "file"],
      ["usr/bin/alias", "symlink"],
    ])
    expect(new TextDecoder().decode(entries[1]!.data)).toBe("#!/bin/sh\n")
    expect(entries[1]!.mode).toBe(0o755)
    expect(entries[2]!.linkTarget).toBe("tool")
  }
})

// ca-certificates ships UTF-8 names in pax records: the lengths there count bytes, not characters.
test("readTar applies pax path and linkpath overrides to the next entry only", () => {
  const long = `usr/share/ca-certificates/${"x".repeat(90)}/NetLock_Arany_=Class_Gold=_Főtanúsítvány.crt`
  const entries = readTar(
    tar([
      { name: "PaxHeader", type: "x", data: paxRecord("path", long) + paxRecord("APK-TOOLS.checksum.SHA1", "abc") },
      { name: "truncated", data: "payload" },
      { name: "next", data: "n" },
    ]),
  )
  expect(entries.map((entry) => entry.path)).toEqual([long, "next"])
})

test("readTar rejects a corrupted header checksum", () => {
  const bytes = tar([{ name: "file", data: "x" }])
  bytes[0] = "y".charCodeAt(0)
  expect(() => readTar(bytes)).toThrow(/checksum/)
})

test("readTar rejects device nodes", () => {
  expect(() => readTar(tar([{ name: "dev/tty", type: "3" }]))).toThrow(/unsupported/)
})

test("safeRelativePath refuses absolute, parent and empty paths", () => {
  expect(safeRelativePath("./usr/bin/git")).toBe("usr/bin/git")
  for (const bad of ["/etc/passwd", "../escape", "usr/../../escape", "", ".", "a\0b"]) {
    expect(() => safeRelativePath(bad)).toThrow(ArchiveError)
  }
})

test("extractEntries writes files with permission bits and strips setuid", () => {
  const dir = tempDir()
  const written = extractEntries(
    readTar(tar([{ name: "usr/bin/tool", data: "abc", mode: 0o4755 }, { name: "etc/conf", data: "c" }])),
    dir,
  )
  expect(fs.readFileSync(path.join(dir, "usr/bin/tool"), "utf8")).toBe("abc")
  expect(written.map((entry) => entry.path).sort()).toEqual(["etc/conf", "usr/bin/tool"])
  expect(written.find((entry) => entry.path === "usr/bin/tool")!.sha256).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  )
  if (process.platform !== "win32") {
    expect(fs.statSync(path.join(dir, "usr/bin/tool")).mode & 0o7777).toBe(0o755)
  }
})

test("extractEntries copies hardlinks from an earlier archive member", () => {
  const dir = tempDir()
  extractEntries(readTar(tar([{ name: "usr/bin/gcc", data: "driver" }, { name: "usr/bin/cc", type: "1", linkname: "usr/bin/gcc" }])), dir)
  expect(fs.readFileSync(path.join(dir, "usr/bin/cc"), "utf8")).toBe("driver")
})

test("extractEntries refuses a hardlink to a member that is not in the archive", () => {
  expect(() => extractEntries(readTar(tar([{ name: "usr/bin/cc", type: "1", linkname: "etc/shadow" }])), tempDir())).toThrow(
    /hardlink/,
  )
})

test("extractEntries refuses a duplicate member", () => {
  expect(() => extractEntries(readTar(tar([{ name: "a", data: "1" }, { name: "a", data: "2" }])), tempDir())).toThrow(/duplicate/)
})

test.skipIf(process.platform === "win32")("extractEntries never writes through a symlink from the archive", () => {
  const dir = tempDir()
  const outside = tempDir()
  const archive = readTar(
    tar([
      { name: "usr/lib", type: "2", linkname: outside },
      { name: "usr/lib/evil", data: "pwned" },
    ]),
  )
  expect(() => extractEntries(archive, dir)).toThrow(/symlink/)
  expect(fs.readdirSync(outside)).toEqual([])
})

test.skipIf(process.platform === "win32")("extractEntries keeps symlink targets verbatim for rootfs-relative resolution", () => {
  const dir = tempDir()
  extractEntries(readTar(tar([{ name: "usr/bin/go", type: "2", linkname: "/usr/lib/go/bin/go" }])), dir)
  expect(fs.readlinkSync(path.join(dir, "usr/bin/go"))).toBe("/usr/lib/go/bin/go")
})

test("extractEntries refuses a destination that already has content", () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, "stale"), "x")
  expect(() => extractEntries([], dir)).toThrow(/empty/)
})
