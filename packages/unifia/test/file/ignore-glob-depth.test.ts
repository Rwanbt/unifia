// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { describe, expect, test } from "bun:test"
import micromatch from "micromatch"
import { FileIgnore } from "../../src/file/ignore"

// Regression cover for GHSA-vfj7-8cjw-p6xm (braces, high, no patched version
// published). `braces` recurses once per `{...}` while compiling a pattern, so a
// deeply nested one exhausts the stack. `watcher.ignore` is not purely local:
// `config.ts` merges project config files found by walking up from the working
// directory, so a cloned repository can supply the pattern.

const nest = (depth: number) => "{".repeat(depth) + "a" + "}".repeat(depth)

describe("FileIgnore.isPathologicalPattern", () => {
  test("the product's own patterns are all accepted", () => {
    const rejected = FileIgnore.PATTERNS.filter((pattern) => FileIgnore.isPathologicalPattern(pattern))
    expect(rejected).toEqual([])
  })

  test("a pattern nested past the limit is refused, one below it is not", () => {
    expect(FileIgnore.isPathologicalPattern(nest(FileIgnore.MAX_BRACE_DEPTH))).toBe(false)
    expect(FileIgnore.isPathologicalPattern(nest(FileIgnore.MAX_BRACE_DEPTH + 1))).toBe(true)
    expect(FileIgnore.isPathologicalPattern(nest(500))).toBe(true)
  })

  test("ordinary glob syntax is not mistaken for nesting", () => {
    for (const pattern of [
      "**/*.log",
      "results-*",
      "node_modules",
      "{a,b}",
      "a{b,c}d",
      "{a,{b,c}}d",
      "*.{ts,tsx}",
      "!(*.test).ts",
    ]) {
      expect(FileIgnore.isPathologicalPattern(pattern)).toBe(false)
    }
  })
})

describe("FileIgnore.boundPatterns", () => {
  test("keeps real patterns and reports the dropped ones by name", () => {
    const bad = nest(500)
    const { kept, dropped } = FileIgnore.boundPatterns(["node_modules", bad, "**/*.log"])
    expect(kept).toEqual(["node_modules", "**/*.log"])
    expect(dropped).toEqual([bad])
  })

  test("an empty list stays empty", () => {
    expect(FileIgnore.boundPatterns([])).toEqual({ kept: [], dropped: [] })
  })
})

describe("the bound sits in front of the pattern compiler", () => {
  test("a pattern nested past the limit is refused before micromatch ever sees it", () => {
    const hostile = nest(1000)
    expect(FileIgnore.isPathologicalPattern(hostile)).toBe(true)
    expect(FileIgnore.boundPatterns([hostile]).kept).toEqual([])
  })

  test("the bound refuses the shapes that are actually expensive to compile", () => {
    // Measured on the installed tree with `micromatch.makeRe`, which is what
    // `@parcel/watcher`'s wrapper calls on every ignore pattern:
    //
    //   depth      makeRe
    //    1 000        46 ms
    //    5 000       783 ms
    //   20 000     12 731 ms     <- this is the denial of service
    //
    // GHSA-vfj7-8cjw-p6xm describes it as stack exhaustion; what this version
    // actually does is blow up superlinearly and then hit V8's own regex length
    // ceiling at about 100 000. Either way the cost is attacker-influenceable if
    // the pattern comes from a project config file, so every one of these shapes
    // is refused at the boundary. The timings are deliberately not asserted: a
    // unit test that takes 12 s to fail is worse than no test.
    for (const depth of [5000, 20000, 100000]) {
      expect(FileIgnore.isPathologicalPattern(nest(depth))).toBe(true)
      expect(FileIgnore.boundPatterns([nest(depth)]).kept).toEqual([])
    }
  })

  test("a pattern at the limit still compiles", () => {
    const atLimit = nest(FileIgnore.MAX_BRACE_DEPTH)
    expect(FileIgnore.isPathologicalPattern(atLimit)).toBe(false)
    expect(() => micromatch.makeRe(atLimit)).not.toThrow()
  })
})
