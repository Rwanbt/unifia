/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, rect } from "../model/fixtures"
import type { TextNodeV1 } from "../model/schema"
import { auditDesignDocument, contrastRatio } from "./studio-audit"

const text = (id: string, fill: string, overrides: Partial<TextNodeV1> = {}): TextNodeV1 => ({
  id,
  name: id,
  parentId: null,
  visible: true,
  locked: false,
  type: "text",
  text: "Hello",
  transform: { x: 10, y: 10, width: 40, height: 20, rotation: 0 },
  style: { fill },
  ...overrides,
})

describe("audit", () => {
  test("contrast follows WCAG: black on white is 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5)
    expect(contrastRatio("red", "#fff")).toBeUndefined()
  })

  test("flags light text on a light shape, hidden and tiny nodes", () => {
    const document = doc([
      rect("bg", { style: { fill: "#ffffff" }, transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0 } }),
      text("t", "#dddddd"),
      rect("hidden", { visible: false }),
      rect("tiny", { transform: { x: 0, y: 0, width: 2, height: 2, rotation: 0 } }),
    ])
    const codes = auditDesignDocument(document).map((finding) => `${finding.code}:${finding.nodeId}`)
    expect(codes).toContain("low-contrast:t")
    expect(codes).toContain("hidden:hidden")
    expect(codes).toContain("tiny:tiny")
  })

  test("a clean document has no findings", () => {
    expect(auditDesignDocument(doc([rect("a"), text("t", "#111111")]))).toEqual([])
  })
})
