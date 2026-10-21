// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/debian.ts: reading a Debian Packages index and resolving the closure of
 * dependencies. The index text below uses the real control-file format (Depends with alternatives
 * and version constraints, Provides for virtual packages).
 */
import { expect, test } from "bun:test"
import { parseIndex, resolve } from "../../src/toolchain/debian"

const index = parseIndex(`Package: git
Version: 1:2.43.0-1
Architecture: arm64
Filename: pool/main/g/git/git_2.43.0-1_arm64.deb
Size: 100
SHA256: ${"a".repeat(64)}
Depends: libc6 (>= 2.38), libpcre2-8-0 (>= 10.22), perl-base | perl, git-man (= 1:2.43.0-1)

Package: libpcre2-8-0
Version: 10.42-4
Architecture: arm64
Filename: pool/main/p/pcre2/libpcre2-8-0_10.42-4_arm64.deb
Size: 20
SHA256: ${"b".repeat(64)}
Depends: libc6 (>= 2.34)

Package: git-man
Version: 1:2.43.0-1
Architecture: all
Filename: pool/main/g/git/git-man_2.43.0-1_all.deb
Size: 30
SHA256: ${"c".repeat(64)}

Package: mawk
Version: 1.3.4
Architecture: arm64
Filename: pool/main/m/mawk/mawk_1.3.4_arm64.deb
Size: 10
SHA256: ${"d".repeat(64)}
Provides: awk
Depends: libc6

Package: perl
Version: 5.38
Architecture: arm64
Filename: pool/main/p/perl/perl_5.38_arm64.deb
Size: 40
SHA256: ${"e".repeat(64)}
Depends: libc6, perl-base

Package: perl-base
Version: 5.38
Architecture: arm64
Filename: pool/main/p/perl/perl-base_5.38_arm64.deb
Size: 50
SHA256: ${"f".repeat(64)}
Depends: libc6

Package: libc6
Version: 2.39
Architecture: arm64
Filename: pool/main/g/glibc/libc6_2.39_arm64.deb
Size: 999
SHA256: ${"9".repeat(64)}
`)

test("reads package name, version, pool path, size and sha256 from each paragraph", () => {
  const git = index.get("git")
  expect(git?.version).toBe("1:2.43.0-1")
  expect(git?.filename).toBe("pool/main/g/git/git_2.43.0-1_arm64.deb")
  expect(git?.size).toBe(100)
  expect(git?.sha256).toBe("a".repeat(64))
})

test("resolves the closure of a root, with the host-provided packages left out", () => {
  const set = resolve(index, ["git"], ["libc6"])
  expect(set.map((item) => item.name)).toEqual(["git", "git-man", "libpcre2-8-0", "perl-base"])
})

test("takes the first alternative that the index can satisfy", () => {
  // "perl-base | perl" resolves to perl-base because it is the first alternative present.
  expect(resolve(index, ["git"], ["libc6"]).map((item) => item.name)).toContain("perl-base")
  expect(resolve(index, ["git"], ["libc6"]).map((item) => item.name)).not.toContain("perl")
})

test("resolves a virtual package through the Provides field of an indexed package", () => {
  const rich = parseIndex(`Package: script
Version: 1
Architecture: arm64
Filename: s.deb
Size: 1
SHA256: ${"1".repeat(64)}
Depends: awk

Package: mawk
Version: 1.3.4
Architecture: arm64
Filename: m.deb
Size: 1
SHA256: ${"2".repeat(64)}
Provides: awk
`)
  expect(resolve(rich, ["script"], ["libc6"]).map((item) => item.name)).toEqual(["mawk", "script"])
})

test("names the dependency that cannot be resolved", () => {
  const broken = parseIndex(`Package: needy
Version: 1
Architecture: arm64
Filename: n.deb
Size: 1
SHA256: ${"3".repeat(64)}
Depends: nothing-provides-this
`)
  expect(() => resolve(broken, ["needy"], [])).toThrow("unresolved dependency: nothing-provides-this")
})
