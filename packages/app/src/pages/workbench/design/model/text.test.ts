/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { textNodeAt } from "../runtime/tools"
import { doc, expectError, rect } from "./fixtures"
import { applyCommand } from "./reducer"
import type { TextNodeV1 } from "./schema"
import { parseDesignDocument } from "./validation"

// #1063 point 3: text nodes carry optional typography (font, size, align)
// edited through one `updateTextStyle` command.

const plain = (overrides: Partial<TextNodeV1> = {}): TextNodeV1 => ({
  id: "t",
  name: "t",
  parentId: null,
  visible: true,
  locked: false,
  type: "text",
  text: "Hello",
  transform: { x: 0, y: 0, width: 100, height: 20, rotation: 0 },
  ...overrides,
})

describe("text: schema", () => {
  test("a text written before typography existed still parses", () => {
    expect(parseDesignDocument(doc([plain()])).nodes.t).toEqual(plain())
  })

  test("typography round-trips and invalid values are refused", () => {
    const styled = plain({ fontFamily: "Georgia", fontSize: 24, align: "center" })
    expect(parseDesignDocument(doc([styled])).nodes.t).toEqual(styled)
    expect(() => parseDesignDocument(doc([plain({ fontSize: 0 })]))).toThrow()
    expect(() => parseDesignDocument(doc([plain({ align: "justify" as never })]))).toThrow()
  })
})

describe("text: textNodeAt", () => {
  test("places a text at the click with explicit default typography", () => {
    const node = textNodeAt({ x: 12, y: 34 }, "n1", "Text")
    expect(node).toMatchObject({ id: "n1", type: "text", text: "Text", fontFamily: "Arial", fontSize: 14, align: "left" })
    expect(node.transform).toEqual({ x: 12, y: 34, width: 160, height: 24, rotation: 0 })
    expect(() => parseDesignDocument(doc([node]))).not.toThrow()
  })
})

describe("text: updateTextStyle", () => {
  test("sets only the given keys and leaves the input untouched", () => {
    const before = doc([plain({ fontFamily: "Arial" })])
    const after = applyCommand(before, { kind: "updateTextStyle", id: "t", fontSize: 32, align: "right" })
    expect(after.nodes.t).toMatchObject({ fontFamily: "Arial", fontSize: 32, align: "right" })
    expect(before.nodes.t).toEqual(plain({ fontFamily: "Arial" }))
  })

  test("trims the font family", () => {
    const after = applyCommand(doc([plain()]), { kind: "updateTextStyle", id: "t", fontFamily: "  Verdana " })
    expect((after.nodes.t as TextNodeV1).fontFamily).toBe("Verdana")
  })

  test("refuses non-text, locked, empty font, non-positive size and unknown align", () => {
    const code = (run: () => unknown) => expectError(run).code
    expect(code(() => applyCommand(doc([rect("t")]), { kind: "updateTextStyle", id: "t", fontSize: 12 }))).toBe("invalid-command")
    expect(code(() => applyCommand(doc([plain({ locked: true })]), { kind: "updateTextStyle", id: "t", fontSize: 12 }))).toBe("node-locked")
    expect(code(() => applyCommand(doc([plain()]), { kind: "updateTextStyle", id: "t", fontFamily: " " }))).toBe("invalid-command")
    for (const fontSize of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(code(() => applyCommand(doc([plain()]), { kind: "updateTextStyle", id: "t", fontSize }))).toBe("invalid-command")
    }
    expect(code(() => applyCommand(doc([plain()]), { kind: "updateTextStyle", id: "t", align: "justify" as never }))).toBe("invalid-command")
    expect(code(() => applyCommand(doc([plain()]), { kind: "updateTextStyle", id: "ghost", align: "left" }))).toBe("node-not-found")
  })

  test("updateText edits the content of a styled text without touching its typography", () => {
    const after = applyCommand(doc([plain({ fontSize: 30 })]), { kind: "updateText", id: "t", text: "Bye" })
    expect(after.nodes.t).toMatchObject({ text: "Bye", fontSize: 30 })
  })
})
