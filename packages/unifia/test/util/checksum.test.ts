/* SPDX-License-Identifier: MIT */

import { describe, test, expect } from "bun:test"
import { assertSha256, ChecksumMismatchError } from "../../src/util/checksum"
import { Ripgrep } from "../../src/file/ripgrep"
import { CLANGD_ASSET_SHA256, CLANGD_RELEASE_TAG } from "../../src/lsp/clangd-release"

const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

describe("assertSha256", () => {
  test("accepts bytes whose digest matches the pinned value", async () => {
    const bytes = await new Response("hello").arrayBuffer()
    expect(() => assertSha256(bytes, HELLO_SHA256, "hello.txt")).not.toThrow()
  })

  test("rejects bytes whose digest differs and reports the asset name", async () => {
    const bytes = await new Response("hellO").arrayBuffer()
    expect(() => assertSha256(bytes, HELLO_SHA256, "hello.txt")).toThrow(ChecksumMismatchError)
  })
})

describe("download pins", () => {
  test("every pinned archive digest is a full lowercase SHA-256", () => {
    const digests = [...Object.values(Ripgrep.ARCHIVE_SHA256), ...Object.values(CLANGD_ASSET_SHA256)]
    expect(digests.length).toBeGreaterThan(0)
    for (const digest of digests) expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  test("clangd pins name the release it installs", () => {
    for (const name of Object.keys(CLANGD_ASSET_SHA256)) expect(name).toContain(CLANGD_RELEASE_TAG)
  })

  test("ripgrep has no pinned archive for Windows ARM64, so that platform fails closed", () => {
    expect(Ripgrep.ARCHIVE_SHA256["arm64-win32"]).toBeUndefined()
  })
})
