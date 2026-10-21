// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/catalog.ts.
 *
 * The manifest is the policy boundary for on-device toolchains: every artifact must come
 * from a trusted https host, carry a size and at least one digest, and be paired with a
 * probe that proves the installed binary runs. Entries pin exact versions, expose only bare
 * binary names, and depend only on acyclic, known entries. These tests exercise the real
 * validator; nothing is mocked.
 */
import { expect, test } from "bun:test"
import { artifactFor, closure, parse } from "../../src/toolchain/catalog"

const url = "https://dl-cdn.alpinelinux.org/alpine/v3.21/main/aarch64/git-2.46.0-r0.apk"
const sha256 = "a".repeat(64)

const artifact = (over: Record<string, unknown> = {}) => ({
  platform: "linux-arm64",
  url,
  archive: "tar.gz",
  prefix: "git-2.46.0",
  size: 1024,
  sha256,
  ...over,
})

const entry = (over: Record<string, unknown> = {}) => ({
  id: "git",
  name: "Git",
  version: "2.46.0",
  license: "MIT",
  bins: ["git"],
  depends: [],
  probe: { args: ["--version"], expect: "2.46.0" },
  artifacts: [artifact()],
  ...over,
})

test("accepts a pinned entry from a trusted https host", () => {
  expect(parse([entry()])).toHaveLength(1)
})

test("defaults depends to an empty list and bindir to bin", () => {
  const [parsed] = parse([entry({ depends: undefined, bindir: undefined })])
  expect(parsed?.depends).toEqual([])
  expect(parsed?.bindir).toBe("bin")
})

test("accepts each permissive licence without an exception", () => {
  for (const license of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]) {
    expect(parse([entry({ license })])).toHaveLength(1)
  }
})

test("rejects a copyleft licence without an ADR exception", () => {
  expect(() => parse([entry({ license: "GPL-2.0-only" })])).toThrow("ADR exception")
})

test("accepts a copyleft licence that cites an ADR exception", () => {
  expect(parse([entry({ license: "GPL-2.0-only", exception: "ADR-027" })])).toHaveLength(1)
})

test("rejects an exception that does not cite an ADR", () => {
  expect(() => parse([entry({ license: "GPL-2.0-only", exception: "approved by email" })])).toThrow("ADR")
})

test("rejects a plain http artifact", () => {
  const plain = artifact({ url: url.replace("https://", "http://") })
  expect(() => parse([entry({ artifacts: [plain] })])).toThrow("https")
})

test("rejects an artifact host outside the trusted list", () => {
  const evil = artifact({ url: "https://evil.example/git.apk" })
  expect(() => parse([entry({ artifacts: [evil] })])).toThrow("trusted")
})

test("accepts the npm and Go module proxy hosts that the pinned toolchains use", () => {
  const npm = artifact({
    platform: "linux-x64",
    url: "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.3.11.tgz",
  })
  const go = artifact({
    url: "https://proxy.golang.org/golang.org/toolchain/@v/v0.0.1-go1.27.3.linux-arm64.zip",
    archive: "zip",
  })
  expect(parse([entry({ artifacts: [npm, go] })])).toHaveLength(1)
})

test("accepts a Node.js artifact from nodejs.org in the tar.xz format", () => {
  const node = artifact({
    platform: "linux-arm64",
    url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-arm64.tar.xz",
    archive: "tar.xz",
    prefix: "node-v24.22.1-linux-arm64",
    sha256: "dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e",
  })
  expect(parse([entry({ artifacts: [node] })])).toHaveLength(1)
})

test("accepts a deb-set artifact that lists verified packages and no single url", () => {
  const set = {
    platform: "linux-arm64",
    archive: "deb-set",
    packages: [
      {
        name: "git",
        version: "1:2.43.0-1ubuntu7.4",
        url: "https://ports.ubuntu.com/ubuntu-ports/pool/main/g/git/git_2.43.0-1ubuntu7.4_arm64.deb",
        size: 5000,
        sha256: "b".repeat(64),
      },
    ],
  }
  expect(parse([entry({ artifacts: [set] })])).toHaveLength(1)
})

test("rejects a deb-set package that has no sha256", () => {
  const set = {
    platform: "linux-arm64",
    archive: "deb-set",
    packages: [{ name: "git", version: "1", url: "https://ports.ubuntu.com/x.deb", size: 5 }],
  }
  expect(() => parse([entry({ artifacts: [set] })])).toThrow()
})

test("rejects a deb-set artifact that also carries a single url", () => {
  const set = {
    platform: "linux-arm64",
    archive: "deb-set",
    url: "https://ports.ubuntu.com/x.deb",
    packages: [{ name: "git", version: "1", url: "https://ports.ubuntu.com/x.deb", size: 5, sha256: "b".repeat(64) }],
  }
  expect(() => parse([entry({ artifacts: [set] })])).toThrow()
})

test("accepts libdirs inside the install root and rejects one that escapes it", () => {
  expect(parse([entry({ libdirs: ["usr/lib/aarch64-linux-gnu", "usr/lib"] })])).toHaveLength(1)
  expect(() => parse([entry({ libdirs: ["../lib"] })])).toThrow("libdirs")
})

test("rejects a sha256 that is not 64 lowercase hex digits", () => {
  const short = artifact({ sha256: "a".repeat(63) })
  const upper = artifact({ sha256: "A".repeat(64) })
  expect(() => parse([entry({ artifacts: [short] })])).toThrow("sha256")
  expect(() => parse([entry({ artifacts: [upper] })])).toThrow("sha256")
})

test("accepts a sha512 SRI digest and an h1 dirhash in place of sha256", () => {
  const npm = artifact({ sha256: undefined, sha512: `sha512-${"A".repeat(86)}==` })
  const go = artifact({ sha256: undefined, h1: "h1:VY4gDzfxOrsM17J2qtgZgiAIsWhp7XWK1jMfE3kXV0s=" })
  expect(parse([entry({ artifacts: [npm] })])).toHaveLength(1)
  expect(parse([entry({ artifacts: [go] })])).toHaveLength(1)
})

test("rejects an artifact that carries no digest at all", () => {
  const bare = artifact({ sha256: undefined })
  expect(() => parse([entry({ artifacts: [bare] })])).toThrow("digest")
})

test("rejects an artifact without a size, since the download must match it exactly", () => {
  const sized = artifact({ size: undefined })
  expect(() => parse([entry({ artifacts: [sized] })])).toThrow()
})

test("rejects two artifacts for the same platform", () => {
  expect(() => parse([entry({ artifacts: [artifact(), artifact({ sha256: "b".repeat(64) })] })])).toThrow(
    "more than one artifact for linux-arm64",
  )
})

test("rejects a prefix or bindir that escapes the install root", () => {
  expect(() => parse([entry({ artifacts: [artifact({ prefix: "../x" })] })])).toThrow("prefix")
  expect(() => parse([entry({ bindir: "/usr/bin" })])).toThrow("bindir")
  expect(() => parse([entry({ bindir: "bin/../../x" })])).toThrow("bindir")
})

test("requires a probe so every install is proven to execute", () => {
  expect(() => parse([entry({ probe: undefined })])).toThrow()
})

test("rejects a version range instead of an exact pin", () => {
  for (const version of ["^2.46.0", "~2.46", ">=2", "*", "latest"]) {
    expect(() => parse([entry({ version })])).toThrow("exact pin")
  }
})

test("rejects binary names that escape the bin directory", () => {
  for (const bins of [["../sh"], ["bin/git"], ["git;rm"], [""]]) {
    expect(() => parse([entry({ bins })])).toThrow("bare file name")
  }
})

test("rejects unknown keys so policy fields cannot be smuggled in", () => {
  expect(() => parse([entry({ postinstall: "curl x | sh" })])).toThrow("Unrecognized key")
})

test("rejects duplicate ids", () => {
  expect(() => parse([entry(), entry()])).toThrow("duplicate toolchain id: git")
})

test("rejects a dependency that is not in the catalog", () => {
  expect(() => parse([entry({ depends: ["missing"] })])).toThrow("unknown toolchain: missing")
})

test("rejects a dependency cycle", () => {
  const cyclic = [
    entry({ id: "alpha", bins: ["alpha"], depends: ["beta"] }),
    entry({ id: "beta", bins: ["beta"], depends: ["alpha"] }),
  ]
  expect(() => parse(cyclic)).toThrow("dependency cycle")
})

test("rejects two entries that provide the same binary", () => {
  const clash = [entry({ id: "alpha", bins: ["sh"] }), entry({ id: "beta", bins: ["sh"] })]
  expect(() => parse(clash)).toThrow("binary sh provided by alpha and beta")
})

test("closure lists dependencies before the entry that needs them", () => {
  const catalog = parse([
    entry({ id: "app", bins: ["app"], depends: ["lib"] }),
    entry({ id: "lib", bins: ["lib"], depends: ["base"] }),
    entry({ id: "base", bins: ["base"] }),
  ])
  expect(closure(catalog, "app").map((item) => item.id)).toEqual(["base", "lib", "app"])
})

test("closure of an entry without dependencies is the entry alone", () => {
  const catalog = parse([entry()])
  expect(closure(catalog, "git").map((item) => item.id)).toEqual(["git"])
})

test("closure rejects an unknown root", () => {
  const catalog = parse([entry()])
  expect(() => closure(catalog, "nope")).toThrow("unknown toolchain: nope")
})

test("artifactFor picks the artifact of the requested platform or nothing", () => {
  const [item] = parse([entry({ artifacts: [artifact(), artifact({ platform: "linux-x64", sha256: "c".repeat(64) })] })])
  expect(artifactFor(item!, "linux-x64")?.sha256).toBe("c".repeat(64))
  expect(artifactFor(item!, "linux-arm64")?.sha256).toBe(sha256)
  const [armOnly] = parse([entry()])
  expect(artifactFor(armOnly!, "linux-x64")).toBeUndefined()
})

test("accepts an env variable that names directories inside the install root, and refuses one that escapes", () => {
  expect(parse([entry({ env: { RUBYLIB: ["usr/lib/ruby/3.2.0"] } })])).toHaveLength(1)
  expect(() => parse([entry({ env: { RUBYLIB: ["../outside"] } })])).toThrow("env paths")
  expect(() => parse([entry({ env: { "bad name": ["usr/lib"] } })])).toThrow("env names")
})
