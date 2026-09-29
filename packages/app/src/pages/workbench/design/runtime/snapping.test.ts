/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, frame, rect } from "../model/fixtures"
import { snapCandidates, snapRect } from "./snapping"

const target = { x: 40, y: 40, width: 100, height: 80 }

describe("design snapping", () => {
  test("snaps an edge to a sibling edge inside the threshold", () => {
    const result = snapRect({ x: 145, y: 300, width: 100, height: 80 }, [target], 8)
    expect(result.x).toBe(140)
    expect(result.y).toBe(300)
    expect(result.guides).toEqual([{ axis: "x", position: 140 }])
  })

  test("snaps a centre line to the target centre", () => {
    const result = snapRect({ x: 86, y: 300, width: 10, height: 10 }, [target], 8)
    expect(result.x).toBe(85)
    expect(result.guides).toEqual([{ axis: "x", position: 90 }])
  })

  test("leaves the rect alone beyond the threshold", () => {
    const result = snapRect({ x: 150, y: 300, width: 100, height: 80 }, [target], 8)
    expect(result.x).toBe(150)
    expect(result.guides).toEqual([])
  })

  test("snaps both axes independently", () => {
    const result = snapRect({ x: 145, y: 122, width: 100, height: 80 }, [target], 8)
    expect(result.x).toBe(140)
    expect(result.y).toBe(120)
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(["x", "y"])
  })

  test("candidates are the siblings plus the parent content box", () => {
    const document = doc([
      frame("f", ["a", "b"], { transform: { x: 10, y: 10, width: 300, height: 200, rotation: 0 } }),
      rect("a", { parentId: "f", transform: { x: 20, y: 20, width: 50, height: 50, rotation: 0 } }),
      rect("b", { parentId: "f", transform: { x: 100, y: 100, width: 50, height: 50, rotation: 0 } }),
    ])
    expect(snapCandidates(document, "b")).toEqual([
      { x: 20, y: 20, width: 50, height: 50 },
      { x: 0, y: 0, width: 300, height: 200 },
    ])
  })

  test("root nodes snap against their siblings only", () => {
    const document = doc([rect("a"), rect("b")])
    expect(snapCandidates(document, "b")).toEqual([{ x: 0, y: 0, width: 10, height: 10 }])
  })
})
