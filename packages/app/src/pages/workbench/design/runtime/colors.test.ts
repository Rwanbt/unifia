/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, expectError, frame, line, path, rect } from "../model/fixtures"
import { applyCommand } from "../model/reducer"
import type { DesignNodeV1, EllipseNodeV1, TextNodeV1 } from "../model/schema"
import { colorInputValue, DESIGN_COLOR_FALLBACK } from "./studio-actions"

// #1063 point 4: fill and stroke per element, edited from Modify through a
// colour picker bound to the same `updateStyle` command as the hex field.

const ellipse = (id: string): EllipseNodeV1 => ({ ...rect(id), type: "ellipse" })
const text = (id: string): TextNodeV1 => ({ ...rect(id), type: "text", text: "Hi" })

describe("colours: colorInputValue", () => {
  test("keeps #rrggbb, lower-cased and trimmed", () => {
    expect(colorInputValue("#AABBCC")).toBe("#aabbcc")
    expect(colorInputValue("  #0a0b0c ")).toBe("#0a0b0c")
  })

  test("expands #rgb", () => {
    expect(colorInputValue("#F0a")).toBe("#ff00aa")
  })

  test("falls back for missing or non-hex colours", () => {
    for (const value of [undefined, "", "red", "none", "rgb(0, 0, 0)", "#12345", "#1234567", "#ggg"]) {
      expect(colorInputValue(value)).toBe(DESIGN_COLOR_FALLBACK)
    }
  })
})

describe("colours: updateStyle per element", () => {
  const styled: [string, DesignNodeV1][] = [
    ["rectangle", rect("n")],
    ["ellipse", ellipse("n")],
    ["path", path("n")],
    ["text", text("n")],
  ]
  for (const [type, node] of styled) {
    test(`${type}: fill and stroke are set independently, other elements untouched`, () => {
      const before = doc([node, rect("other", { style: { fill: "#111111" } })])
      const filled = applyCommand(before, { kind: "updateStyle", id: "n", style: { fill: "#ff0000" } })
      const both = applyCommand(filled, { kind: "updateStyle", id: "n", style: { stroke: "#00ff00" } })
      expect((both.nodes.n as { style?: object }).style).toEqual({ fill: "#ff0000", stroke: "#00ff00" })
      expect(both.nodes.other).toEqual(before.nodes.other)
    })
  }

  test("a line has a stroke only: fill is ignored", () => {
    const next = applyCommand(doc([line("l")]), { kind: "updateStyle", id: "l", style: { fill: "#ff0000", stroke: "#0000ff" } })
    expect(next.nodes.l).toMatchObject({ stroke: "#0000ff" })
    expect("fill" in next.nodes.l!).toBe(false)
  })

  test("clearing a colour removes it so the renderer default applies", () => {
    const before = doc([rect("r", { style: { fill: "#ff0000", stroke: "#000000" } })])
    const next = applyCommand(before, { kind: "updateStyle", id: "r", style: { fill: undefined } })
    expect((next.nodes.r as { style?: object }).style).toEqual({ stroke: "#000000" })
  })

  test("frames and locked elements refuse colour edits", () => {
    expect(expectError(() => applyCommand(doc([frame("f")]), { kind: "updateStyle", id: "f", style: { fill: "#fff" } })).code).toBe(
      "invalid-command",
    )
    expect(
      expectError(() => applyCommand(doc([rect("r", { locked: true })]), { kind: "updateStyle", id: "r", style: { stroke: "#fff" } })).code,
    ).toBe("node-locked")
  })
})
