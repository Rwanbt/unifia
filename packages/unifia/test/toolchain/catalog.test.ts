// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/catalog.ts.
 *
 * The manifest is the policy boundary for on-device toolchains: a source must be
 * an https URL on a trusted host, pinned by an exact version and a SHA-256, expose
 * only bare binary names, and depend only on acyclic, known entries. These tests
 * exercise the real validator; nothing is mocked.
 */
import { expect, test } from "bun:test"
import { closure, parse } from "../../src/toolchain/catalog"

const url = "https://dl-cdn.alpinelinux.org/alpine/v3.21/main/aarch64/git-2.46.0-r0.apk"
const sha256 = "a".repeat(64)

const entry = (over: Record<string, unknown> = {}) => ({
  id: "git",
  name: "Git",
  version: "2.46.0",
  arch: "aarch64",
  license: "GPL-2.0-only",
  source: { url, sha256 },
  bins: ["git"],
  depends: [],
  ...over,
})

test("accepts a pinned entry from a trusted https host", () => {
  expect(parse([entry()])).toHaveLength(1)
})

test("defaults depends to an empty list", () => {
  const [parsed] = parse([entry({ depends: undefined })])
  expect(parsed?.depends).toEqual([])
})

test("rejects a plain http source", () => {
  const source = { url: url.replace("https://", "http://"), sha256 }
  expect(() => parse([entry({ source })])).toThrow("https")
})

test("rejects a source host outside the trusted list", () => {
  const source = { url: "https://evil.example/git.apk", sha256 }
  expect(() => parse([entry({ source })])).toThrow("trusted")
})

test("rejects a sha256 that is not 64 lowercase hex digits", () => {
  const short = { url, sha256: "a".repeat(63) }
  const upper = { url, sha256: "A".repeat(64) }
  expect(() => parse([entry({ source: short })])).toThrow("sha256")
  expect(() => parse([entry({ source: upper })])).toThrow("sha256")
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
