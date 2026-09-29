/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  isContained,
  stripWindowsNamespace,
  wouldBeContained,
} from "../../../src/knowledge/source/containment"

describe("stripWindowsNamespace (#79)", () => {
  test("leaves plain paths untouched", () => {
    expect(stripWindowsNamespace("C:\\vault\\note.md")).toBe("C:\\vault\\note.md")
    expect(stripWindowsNamespace("/vault/note.md")).toBe("/vault/note.md")
  })

  test("strips the drive-letter namespaced prefix", () => {
    expect(stripWindowsNamespace("\\\\?\\C:\\vault\\note.md")).toBe("C:\\vault\\note.md")
    expect(stripWindowsNamespace("\\\\?\\D:\\a\\_temp\\x.md")).toBe("D:\\a\\_temp\\x.md")
  })

  test("converts the UNC namespaced prefix to the plain UNC form", () => {
    expect(stripWindowsNamespace("\\\\?\\UNC\\server\\share\\note.md")).toBe("\\\\server\\share\\note.md")
  })

  test("leaves volume-GUID paths untouched", () => {
    const volume = "\\\\?\\Volume{1234-5678}\\note.md"
    expect(stripWindowsNamespace(volume)).toBe(volume)
  })
})

describe("containment with a namespaced real root (#79)", () => {
  test("accepts a new file under a plain root", () => {
    const root = mkdtempSync(join(tmpdir(), "containment-plain-"))
    expect(wouldBeContained(root, join(root, "new.md"))).toBe(true)
  })

  test("accepts an existing file under a plain root", () => {
    const root = mkdtempSync(join(tmpdir(), "containment-exists-"))
    const file = join(root, "note.md")
    writeFileSync(file, "x")
    expect(isContained(root, file)).toBe(true)
  })

  test.skipIf(process.platform !== "win32")(
    "accepts a candidate under a \\\\?\\-prefixed root (CI runner condition)",
    () => {
      // GitHub's Windows runner returns the prefixed form from
      // realpathSync.native while join(root, locator) does not. Before the
      // fix this pair failed the lexical check and every writer test threw
      // "locator escapes the vault root" (the systemic CI failures, #79).
      const root = mkdtempSync(join(tmpdir(), "containment-prefixed-"))
      expect(wouldBeContained("\\\\?\\" + root, join(root, "new.md"))).toBe(true)
      const file = join(root, "note.md")
      writeFileSync(file, "x")
      expect(isContained("\\\\?\\" + root, file)).toBe(true)
    },
  )

  test("still refuses a sibling directory outside the root", () => {
    const root = mkdtempSync(join(tmpdir(), "containment-root-"))
    const outside = root + "-sibling"
    expect(wouldBeContained(root, join(outside, "n.md"))).toBe(false)
    expect(isContained(root, outside)).toBe(false)
  })

  test("still refuses a new file that climbs out with ..", () => {
    const root = mkdtempSync(join(tmpdir(), "containment-climb-"))
    const sibling = mkdtempSync(join(tmpdir(), "containment-outside-"))
    expect(wouldBeContained(root, join(sibling, "x.md"))).toBe(false)
    expect(wouldBeContained(root, root + "\\..\\..\\escape\\x.md")).toBe(false)
  })

  test.skipIf(process.platform !== "win32")(
    "accepts a candidate under a junctioned root (CI temp condition)",
    () => {
      // The CI runner can expose its temp root through a reparse point:
      // realpathSync.native(root) is the junction target while
      // join(root, locator) keeps the kernel path. The removed lexical
      // pre-check rejected exactly that pair on every write (#79).
      const target = mkdtempSync(join(tmpdir(), "containment-junction-"))
      const link = target + "-link"
      symlinkSync(target, link, "junction")
      const realTarget = realpathSync.native(target)
      expect(wouldBeContained(realTarget, join(link, "new.md"))).toBe(true)
      const file = join(target, "note.md")
      writeFileSync(file, "x")
      expect(isContained(realTarget, join(link, "note.md"))).toBe(true)
    },
  )
})