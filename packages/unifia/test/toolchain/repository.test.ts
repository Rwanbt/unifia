/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  ALPINE_KEYS,
  type IndexPackage,
  RepositoryError,
  compareVersions,
  loadIndex,
  parseIndex,
  resolve,
  verifyPackage,
} from "../../src/toolchain/repository"
import { concat, gzip, tar } from "./tar-fixture"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const KEY = { name: "test@example.org-1.rsa.pub", pem: publicKey.export({ type: "spki", format: "pem" }).toString() }

function signedStream(signedMember: Uint8Array, keyName = KEY.name): Uint8Array {
  const signature = sign("sha1", signedMember, privateKey)
  return concat(gzip(tar([{ name: `.SIGN.RSA.${keyName}`, data: signature }], false)), signedMember)
}

const INDEX_TEXT = [
  "C:Q1abc=\nP:app\nV:2.0-r1\nA:aarch64\nS:10\nI:20\nL:MIT\nD:libfoo>=1.2 cmd:sh !old-app\np:cmd:app=2.0-r1\n",
  "C:Q1def=\nP:libfoo\nV:1.10-r0\nA:aarch64\nS:1\nI:2\nL:BSD-3-Clause\nD:so:libc.musl-aarch64.so.1\n",
  "C:Q1ghi=\nP:busybox\nV:1.37.0-r0\nA:aarch64\nS:1\nI:2\nL:GPL-2.0-only\np:cmd:sh=1.37.0-r0\n",
  "C:Q1jkl=\nP:musl\nV:1.2.5-r9\nA:aarch64\nS:1\nI:2\nL:MIT\np:so:libc.musl-aarch64.so.1=1\n",
].join("\n")

test("pinned Alpine keys match the files published by alpinelinux.org and aports", () => {
  const digest = (pem: string) => createHash("sha256").update(pem).digest("hex")
  expect(digest(ALPINE_KEYS.aarch64.pem)).toBe("d11f6b21c61b4274e182eb888883a8ba8acdbf820dcc7a6d82a7d9fc2fd2836d")
  expect(digest(ALPINE_KEYS.x86_64.pem)).toBe("207e4696d3c05f7cb05966aee557307151f1f00217af4143c1bcaf33b8df733f")
})

test("parseIndex reads the fields the resolver and installer need", () => {
  const app = parseIndex(INDEX_TEXT).find((entry) => entry.name === "app")!
  expect(app).toMatchObject({ version: "2.0-r1", arch: "aarch64", size: 10, installedSize: 20, license: "MIT", checksum: "Q1abc=" })
  expect(app.depends).toEqual(["libfoo>=1.2", "cmd:sh", "!old-app"])
  expect(app.provides).toEqual(["cmd:app=2.0-r1"])
})

test("loadIndex accepts an index signed by a pinned key", () => {
  const control = gzip(tar([{ name: "DESCRIPTION", data: "v3.21" }, { name: "APKINDEX", data: INDEX_TEXT }]))
  expect(loadIndex(signedStream(control), [KEY]).map((entry) => entry.name)).toEqual(["app", "libfoo", "busybox", "musl"])
})

test("loadIndex rejects a tampered index, an unknown key and a missing signature", () => {
  const control = gzip(tar([{ name: "APKINDEX", data: INDEX_TEXT }]))
  const tampered = signedStream(control)
  tampered[tampered.length - 9]! ^= 0xff
  expect(() => loadIndex(tampered, [KEY])).toThrow(RepositoryError)
  expect(() => loadIndex(signedStream(control, "attacker.rsa.pub"), [KEY])).toThrow(/not pinned/)
  expect(() => loadIndex(control, [KEY])).toThrow(RepositoryError)
})

test("verifyPackage checks a real Alpine package against the pinned aarch64 key", () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(import.meta.dir, "fixtures/zlib-1.3.2-r1-aarch64.apk")))
  const [entry] = parseIndex("C:Q1YvvkcqTZUW0Fk+hcg4wl+nf1rPU=\nP:zlib\nV:1.3.2-r1\nA:aarch64\nS:54390\nI:133008\nL:Zlib\n")
  const verified = verifyPackage(bytes, entry!, [ALPINE_KEYS.aarch64])
  expect(verified.entries.map((file) => file.path)).toContain("usr/lib/libz.so.1.3.2")
  expect(verified.sha256).toBe("47bdb66edfddca8b64438369affabd9debc05159aa1bff5c26027270cb28b3f7")
  expect(() => verifyPackage(bytes, { ...entry!, checksum: "Q1AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }, [ALPINE_KEYS.aarch64])).toThrow(/checksum/)
  expect(() => verifyPackage(bytes, entry!, [ALPINE_KEYS.x86_64])).toThrow(/not pinned/)
  expect(() => verifyPackage(bytes, { ...entry!, size: 1 }, [ALPINE_KEYS.aarch64])).toThrow(/size/)
})

function fakePackage(dataTamper = false) {
  const data = gzip(tar([{ name: "usr/bin/app", data: "binary" }]))
  const datahash = createHash("sha256").update(data).digest("hex")
  const control = gzip(tar([{ name: ".PKGINFO", data: `pkgname = app\npkgver = 2.0-r1\ndatahash = ${datahash}\n` }], false))
  const checksum = "Q1" + createHash("sha1").update(control).digest("base64")
  const shipped = dataTamper ? gzip(tar([{ name: "usr/bin/app", data: "evil!!" }])) : data
  const bytes = concat(signedStream(control), shipped)
  const entry: IndexPackage = { ...parseIndex(INDEX_TEXT)[0]!, checksum, size: bytes.length }
  return { bytes, entry }
}

test("verifyPackage binds the data segment through the signed SHA-256 datahash", () => {
  const good = fakePackage()
  expect(verifyPackage(good.bytes, good.entry, [KEY]).entries[0]!.path).toBe("usr/bin/app")
  const bad = fakePackage(true)
  expect(() => verifyPackage(bad.bytes, { ...bad.entry, size: bad.bytes.length }, [KEY])).toThrow(/datahash/)
})

test("resolve returns the dependency closure, dependencies first, through so: and cmd: provides", () => {
  expect(resolve(parseIndex(INDEX_TEXT), ["app"]).map((entry) => entry.name)).toEqual(["musl", "libfoo", "busybox", "app"])
})

test("resolve refuses unknown packages and unmet version constraints", () => {
  expect(() => resolve(parseIndex(INDEX_TEXT), ["missing"])).toThrow(/missing/)
  const strict = INDEX_TEXT.replace("libfoo>=1.2", "libfoo>=1.11")
  expect(() => resolve(parseIndex(strict), ["app"])).toThrow(/libfoo>=1.11/)
})

test("compareVersions follows apk ordering", () => {
  expect(compareVersions("1.10-r0", "1.9-r5")).toBeGreaterThan(0)
  expect(compareVersions("3.12.15-r0", "3.12.15-r1")).toBeLessThan(0)
  expect(compareVersions("1.2.3_rc1-r0", "1.2.3-r0")).toBeLessThan(0)
  expect(compareVersions("1.2.3_p1-r0", "1.2.3-r0")).toBeGreaterThan(0)
  expect(compareVersions("2.0a-r0", "2.0-r0")).toBeGreaterThan(0)
  expect(compareVersions("1.0-r0", "1.0-r0")).toBe(0)
})
