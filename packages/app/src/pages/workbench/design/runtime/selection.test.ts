/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, frame, rect } from "../model/fixtures"
import { nodeWorldRect, normalizeSelection, pickInRect, selectionMoves, toggleSelection } from "./selection"

const box = (x: number, y: number, width: number, height: number, rotation = 0) => ({ x, y, width, height, rotation })

describe("design selection rules", () => {
  test("toggleSelection adds, removes and keeps the hierarchy invariant", () => {
    const document = doc([
      frame("f", ["a", "b"]),
      rect("a", { parentId: "f" }),
      rect("b", { parentId: "f" }),
      rect("r"),
    ])
    expect(toggleSelection(document, [], "a")).toEqual(["a"])
    expect(toggleSelection(document, ["a"], "a")).toEqual([])
    expect(toggleSelection(document, ["a"], "r")).toEqual(["a", "r"])
    // Drilling: adding a child replaces its selected ancestor.
    expect(toggleSelection(document, ["f"], "a")).toEqual(["a"])
    // Escalating: adding a container replaces its selected descendants.
    expect(toggleSelection(document, ["a", "b"], "f")).toEqual(["f"])
    expect(toggleSelection(document, ["a"], "b")).toEqual(["a", "b"])
  })

  test("normalizeSelection keeps descendants over their containers", () => {
    const document = doc([frame("f", ["a", "b"]), rect("a", { parentId: "f" }), rect("b", { parentId: "f" })])
    expect(normalizeSelection(document, ["f", "a", "b"])).toEqual(["a", "b"])
    expect(normalizeSelection(document, ["f"])).toEqual(["f"])
    expect(normalizeSelection(document, ["a", "b"])).toEqual(["a", "b"])
  })

  test("selectionMoves rotates a world delta into each parent space", () => {
    const document = doc([
      frame("f", ["a"], { transform: box(100, 100, 200, 200, 90) }),
      rect("a", { parentId: "f", transform: box(0, 0, 10, 10) }),
      rect("r"),
      rect("locked-r", { locked: true }),
    ])
    expect(selectionMoves(document, ["r"], { x: 5, y: 7 })).toEqual([{ id: "r", delta: { x: 5, y: 7 } }])
    // A 90° parent maps world (0,10) back to (10,0) in parent space.
    const [rotated] = selectionMoves(document, ["a"], { x: 0, y: 10 })
    if (!rotated) throw new Error("expected a rotated move")
    expect(rotated.id).toBe("a")
    expect(rotated.delta.x).toBeCloseTo(10, 10)
    expect(rotated.delta.y).toBeCloseTo(0, 10)
    expect(selectionMoves(document, ["locked-r"], { x: 5, y: 5 })).toEqual([])
  })

  test("nodeWorldRect bounds a rotated node by its AABB", () => {
    const document = doc([rect("r", { transform: box(100, 100, 100, 100, 45) })])
    const world = nodeWorldRect(document, "r")
    if (!world) throw new Error("expected a world rect")
    const reach = (100 * Math.SQRT2) / 2
    expect(world.x).toBeCloseTo(150 - reach, 5)
    expect(world.y).toBeCloseTo(150 - reach, 5)
    expect(world.width).toBeCloseTo(reach * 2, 5)
    expect(world.height).toBeCloseTo(reach * 2, 5)
  })

  test("pickInRect intersects visible, unlocked nodes and prefers children", () => {
    const document = doc([
      frame("f", ["a", "b"], { transform: box(0, 0, 100, 100) }),
      rect("a", { parentId: "f", transform: box(10, 10, 20, 20) }),
      rect("b", { parentId: "f", transform: box(50, 50, 20, 20) }),
      rect("hidden", { visible: false, transform: box(200, 200, 20, 20) }),
      rect("locked", { locked: true, transform: box(250, 250, 20, 20) }),
    ])
    // A marquee inside the frame selects the children, not the frame.
    expect(pickInRect(document, { x: 5, y: 5, width: 60, height: 60 })).toEqual(["a", "b"])
    // A marquee around everything still keeps the children (documented rule:
    // descendants win over the containers that wrap them).
    expect(pickInRect(document, { x: -10, y: -10, width: 200, height: 200 })).toEqual(["a", "b"])
    // Hidden and locked nodes are never picked.
    expect(pickInRect(document, { x: 190, y: 190, width: 100, height: 100 })).toEqual([])
    expect(pickInRect(document, { x: 500, y: 500, width: 10, height: 10 })).toEqual([])
  })
})
