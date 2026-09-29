/* SPDX-License-Identifier: MIT */

// CodeQL js/polynomial-redos: a heading padded with spaces made the heading
// regular expression quadratic.
import { describe, expect, test } from "bun:test"
import { parseDesignMd } from "../src/parse-design-md"

describe("parseDesignMd adversarial input", () => {
  test("a heading with a huge run of spaces parses in linear time", () => {
    const source = `## a${" ".repeat(150_000)}x \n`
    const start = performance.now()
    parseDesignMd("x", source)
    expect(performance.now() - start).toBeLessThan(750)
  })

  test("headings keep mapping to sections, with a numeric prefix and trailing spaces", () => {
    const parsed = parseDesignMd("x", "## 2. Colors   \nbrand blue\n## Typography\nInter\n")
    expect(parsed.sections.color).toBe("brand blue")
    expect(parsed.sections.typography).toBe("Inter")
  })

  test("a heading longer than any section name cannot map to one", () => {
    const parsed = parseDesignMd("x", `## colors${" filler".repeat(100)}\nbody\n`)
    expect(parsed.sections.color).toBeUndefined()
  })
})
