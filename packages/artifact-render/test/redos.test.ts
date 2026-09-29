/* SPDX-License-Identifier: MIT */

// CodeQL js/polynomial-redos: these inputs took seconds with the previous
// regular expressions (quadratic in the input) and now run in linear time.
import { describe, expect, test } from "bun:test"
import { annotateSelectableElements, buildSrcdoc } from "@unifia/artifact-render"
import { readPaletteFromRoot } from "../src/bridges/palette"

const BUDGET_MS = 750

function elapsed(run: () => unknown): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

describe("adversarial input stays linear", () => {
  test("annotateSelectableElements: a tag name followed by a long run of spaces and no `>`", () => {
    expect(elapsed(() => annotateSelectableElements(`<a${" ".repeat(120_000)}`))).toBeLessThan(BUDGET_MS)
  })

  test("annotateSelectableElements: attributes, trailing whitespace and the self-closing slash still split as before", () => {
    // The doubled space in `<br  />` is what the previous two-group expression produced; kept on purpose.
    expect(annotateSelectableElements('<br />')).toBe('<br  />')
    expect(annotateSelectableElements('<div class="a" />')).toContain('<div class="a"')
    expect(annotateSelectableElements("<div >x</div>")).toContain("<div ")
  })

  test("buildSrcdoc: thousands of `<head` with no closing `>`", () => {
    expect(elapsed(() => buildSrcdoc("<head".repeat(40_000)))).toBeLessThan(BUDGET_MS)
  })

  test("readPaletteFromRoot: many `--x:` declarations that never end in `;`", () => {
    expect(elapsed(() => readPaletteFromRoot("--a:x".repeat(40_000)))).toBeLessThan(BUDGET_MS)
  })

  test("readPaletteFromRoot still reads ordinary variables", () => {
    expect(readPaletteFromRoot(":root { --bg: #fff; --fg :  #000; }")).toEqual([
      { name: "--bg", value: "#fff" },
      { name: "--fg", value: "#000" },
    ])
  })
})
