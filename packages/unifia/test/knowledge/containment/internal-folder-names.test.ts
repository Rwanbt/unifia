/* SPDX-License-Identifier: MIT */
/**
 * The name of the vault's own folder, `.unifia`, as every platform that can hold a vault spells it.
 *
 * One rule decides the name everywhere (the walk, recovery, the writer and the links), so these cases are the whole contract.
 * The rule folds the spellings a single folder can have on any platform, and refuses all of them on every platform: the same
 * repository is cloned on Linux, opened on macOS and synced to Windows, and a folder that is `.UNIFIA` on one is `.unifia` on
 * another. Each case names the platform that produces the spelling. Where a case was not run on that platform, it is marked.
 */

import { describe, expect, test } from "bun:test"
import { isInternalLocator } from "../../../src/knowledge/source/containment.js"

/** Spellings of the folder. Each is placed under `notes/`, so each case is a locator the writer would receive. */
const FOLDER_SPELLINGS: ReadonlyArray<readonly [segment: string, platform: string]> = [
  [".unifia", "all: the folder as written"],
  [".UNIFIA", "macOS and Windows fold case; Linux does not, refused everywhere"],
  [".Unifia", "macOS and Windows fold case; Linux does not, refused everywhere"],
  [".unifia.", "Windows: trailing dots are dropped from a name"],
  [".unifia ", "Windows: trailing spaces are dropped from a name"],
  [".unifia. .", "Windows: trailing dots and spaces together"],
  ["UNIFIA~1", "Windows: the 8.3 short name of .unifia"],
  ["unifia~12", "Windows: an 8.3 short name after a collision"],
  [".unifia:stream", "NTFS: an alternate data stream of the folder (reasoning only, not run on Windows)"],
  [".unifia::$INDEX_ALLOCATION", "NTFS: the folder itself, by its directory index (reasoning only, not run on Windows)"],
  [".unıfıa", "NTFS upper-cases dotless i to I (reasoning only, not run on Windows)"],
]

/** Names that are not the folder. Each one is a close neighbour of a spelling above, or a device name, which has its own rule. */
const NOT_THE_FOLDER: ReadonlyArray<readonly [segment: string, why: string]> = [
  ["unifia", "a folder named without the dot is an ordinary folder"],
  [".unifia-notes", "a different folder whose name starts the same way"],
  ["my.unifia", "the name only ends with the folder name"],
  [".unifia2", "a different name"],
  ["Unifia Notes", "a long name: its 8.3 short name is UNIFIA~1, but a walk reads long names, so the long name is ordinary"],
  ["UNIFIA~", "an 8.3 form with no number"],
  ["UNIFIA~1x", "an 8.3 form with a suffix"],
  [".unifia.md", "a note file, not a folder"],
  ["CON", "a Windows device name: not the folder, and refused by the device rule"],
  ["CON.unifia", "a device name with an extension: the device, not the folder"],
  ["NUL.", "a device name with a trailing dot: the device, not the folder"],
  ["COM1 ", "a device name with a trailing space: the device, not the folder"],
]

describe("the folder's name, as a segment of a locator", () => {
  for (const [segment, platform] of FOLDER_SPELLINGS) {
    test(`${JSON.stringify(segment)} is the folder (${platform})`, () => {
      expect(isInternalLocator(`notes/${segment}/memo.md`)).toBe(true)
    })
  }

  for (const [segment, why] of NOT_THE_FOLDER) {
    test(`${JSON.stringify(segment)} is not the folder: ${why}`, () => {
      expect(isInternalLocator(`notes/${segment}/memo.md`)).toBe(false)
    })
  }
})

describe("the folder's name, at any depth and under either separator", () => {
  test("the folder at the vault root is internal", () => {
    expect(isInternalLocator(".unifia/policy.json")).toBe(true)
  })

  test("the folder deep in a tree is internal", () => {
    expect(isInternalLocator("a/b/c/.unifia/x.md")).toBe(true)
  })

  test("a Windows separator counts as a separator", () => {
    expect(isInternalLocator("notes\\.unifia\\x.md")).toBe(true)
  })

  test("a device name in the path does not hide the folder", () => {
    expect(isInternalLocator("CON/.unifia/x.md")).toBe(true)
  })

  test("a path with no such segment is not internal", () => {
    expect(isInternalLocator("notes/x.md")).toBe(false)
    expect(isInternalLocator("unifia/x.md")).toBe(false)
  })
})
