/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { DesignDocumentError } from "../model/errors"
import { doc, frame, rect, zeroTransform } from "../model/fixtures"
import { applyToPoint, identityMatrix, localMatrix, multiplyMatrices, nodeMatrix } from "./geometry"

function translate(x: number, y: number) {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y }
}

describe("design geometry", () => {
  test("identity leaves points untouched", () => {
    expect(applyToPoint(identityMatrix, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 })
  })

  test("multiply composes right-first", () => {
    const matrix = multiplyMatrices(translate(10, 0), translate(5, 0))
    expect(applyToPoint(matrix, { x: 0, y: 0 })).toEqual({ x: 15, y: 0 })
  })

  test("a 90 degree rotation turns the square clockwise around its centre", () => {
    const matrix = localMatrix({ ...zeroTransform, rotation: 90 })
    const topLeft = applyToPoint(matrix, { x: 0, y: 0 })
    expect(topLeft.x).toBeCloseTo(10, 10)
    expect(topLeft.y).toBeCloseTo(0, 10)
    const bottomRight = applyToPoint(matrix, { x: 10, y: 10 })
    expect(bottomRight.x).toBeCloseTo(0, 10)
    expect(bottomRight.y).toBeCloseTo(10, 10)
  })

  test("nodeMatrix composes the ancestor chain", () => {
    const document = doc([
      frame("f", ["a"], { transform: { x: 10, y: 0, width: 100, height: 100, rotation: 0 } }),
      rect("a", { parentId: "f", transform: { x: 5, y: 0, width: 10, height: 10, rotation: 0 } }),
    ])
    const matrix = nodeMatrix(document, "a")
    expect(applyToPoint(matrix, { x: 0, y: 0 })).toEqual({ x: 15, y: 0 })
  })

  test("nodeMatrix refuses an unknown node", () => {
    expect(() => nodeMatrix(doc([]), "ghost")).toThrow(DesignDocumentError)
  })
})
