/* SPDX-License-Identifier: MIT */

// CodeQL js/polynomial-redos: these inputs took seconds with the previous
// regular expressions (quadratic in the input) and now run in linear time.
import { describe, expect, test } from "bun:test"
import { annotateSelectableElements, buildSrcdoc } from "@unifia/artifact-render"
import { readPaletteFromRoot } from "../src/bridges/palette"

// Growth, not an absolute budget: a fixed millisecond limit failed on slower
// CI runners for code that is linear (readPaletteFromRoot: 859 ms on Windows,
// ratio 4.5 for 4x the input). Quadrupling the input of linear code roughly
// quadruples its time; quadratic code takes ~16x.
const MAX_GROWTH_FOR_4X_INPUT = 10
// Below this, both runs are too fast to tell growth from timer noise, and too
// fast to be the multi-second blow-up this file guards against.
const NOISE_FLOOR_MS = 50
const RUNS = 3

function fastest(run: () => unknown): number {
  let best = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < RUNS; attempt++) {
    const start = performance.now()
    run()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

function expectLinear(build: (size: number) => unknown, size: number): void {
  const small = fastest(() => build(size / 4))
  const large = fastest(() => build(size))
  if (large < NOISE_FLOOR_MS) return
  expect(large / Math.max(small, 0.001)).toBeLessThan(MAX_GROWTH_FOR_4X_INPUT)
}

describe("adversarial input stays linear", () => {
  test("annotateSelectableElements: a tag name followed by a long run of spaces and no `>`", () => {
    expectLinear((size) => annotateSelectableElements(`<a${" ".repeat(size)}`), 120_000)
  })

  test("annotateSelectableElements: attributes, trailing whitespace and the self-closing slash still split as before", () => {
    // The doubled space in `<br  />` is what the previous two-group expression produced; kept on purpose.
    expect(annotateSelectableElements('<br />')).toBe('<br  />')
    expect(annotateSelectableElements('<div class="a" />')).toContain('<div class="a"')
    expect(annotateSelectableElements("<div >x</div>")).toContain("<div ")
  })

  test("buildSrcdoc: thousands of `<head` with no closing `>`", () => {
    expectLinear((size) => buildSrcdoc("<head".repeat(size)), 40_000)
  })

  test("readPaletteFromRoot: many `--x:` declarations that never end in `;`", () => {
    expectLinear((size) => readPaletteFromRoot("--a:x".repeat(size)), 40_000)
  })

  test("readPaletteFromRoot still reads ordinary variables", () => {
    expect(readPaletteFromRoot(":root { --bg: #fff; --fg :  #000; }")).toEqual([
      { name: "--bg", value: "#fff" },
      { name: "--fg", value: "#000" },
    ])
  })
})
