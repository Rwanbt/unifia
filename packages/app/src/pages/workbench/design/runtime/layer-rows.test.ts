/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, frame, rect } from "../model/fixtures"
import { buildLayerRows, resolveLayerDrop } from "./layer-rows"

describe("design layer rows", () => {
  test("rows are frontmost first, parents before their children", () => {
    const document = doc([
      frame("f", ["a", "b"]),
      rect("a", { parentId: "f" }),
      rect("b", { parentId: "f" }),
      rect("r"),
    ])
    const rows = buildLayerRows(document)
    expect(rows.map((row) => row.id)).toEqual(["r", "f", "b", "a"])
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 1])
    expect(rows.find((row) => row.id === "f")?.container).toBe(true)
    expect(rows.find((row) => row.id === "b")?.parentId).toBe("f")
  })

  test("drops on a sibling reorder to its position in the shared parent", () => {
    const document = doc([frame("f", ["a", "b"]), rect("a", { parentId: "f" }), rect("b", { parentId: "f" })])
    expect(resolveLayerDrop(document, "a", "b")).toEqual({ kind: "reorderNode", id: "a", toIndex: 1 })
  })

  test("drops on a container from another parent reparent into it, frontmost", () => {
    const document = doc([frame("f", ["a"]), rect("a", { parentId: "f" }), rect("r")])
    expect(resolveLayerDrop(document, "r", "f")).toEqual({ kind: "reparentNode", id: "r", parentId: "f", index: 1 })
  })

  test("drops on a leaf from another parent reparent to its position", () => {
    const document = doc([frame("f", ["a"]), rect("a", { parentId: "f" }), rect("r")])
    expect(resolveLayerDrop(document, "r", "a")).toEqual({ kind: "reparentNode", id: "r", parentId: "f", index: 0 })
  })

  test("a drop on itself or an unknown node resolves to nothing", () => {
    const document = doc([rect("a")])
    expect(resolveLayerDrop(document, "a", "a")).toBeUndefined()
    expect(resolveLayerDrop(document, "a", "ghost")).toBeUndefined()
    expect(resolveLayerDrop(document, "ghost", "a")).toBeUndefined()
  })
})
