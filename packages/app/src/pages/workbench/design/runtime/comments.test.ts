/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { comment, doc, rect } from "../model/fixtures"
import { commentPinOffset, commentPinPosition } from "./comments"

describe("design comment pins", () => {
  test("an anchored comment sits at the node's top-right corner", () => {
    const document = doc([rect("a", { transform: { x: 100, y: 100, width: 50, height: 50, rotation: 0 } })])
    expect(commentPinPosition(document, comment("c1", { nodeId: "a", x: 0, y: 0 }))).toEqual({
      x: 150 + commentPinOffset,
      y: 100 - commentPinOffset,
    })
  })

  test("a zone comment keeps its stored world position", () => {
    const document = doc([rect("a")])
    expect(commentPinPosition(document, comment("c1", { nodeId: null, x: 42, y: 24 }))).toEqual({ x: 42, y: 24 })
  })

  test("a comment outlives its node and falls back to its stored position", () => {
    const document = doc([rect("a")])
    expect(commentPinPosition(document, comment("c1", { nodeId: "deleted", x: 7, y: 8 }))).toEqual({ x: 7, y: 8 })
    expect(commentPinPosition(document, comment("c2", { nodeId: "deleted", x: Number.NaN, y: 0 }))).toBeUndefined()
  })
})
