/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { DesignDocumentError } from "../model/errors"
import { doc, frame, rect } from "../model/fixtures"
import { applyToPoint } from "./geometry"
import { buildRenderList } from "./render-model"

describe("design render model", () => {
  test("paint order is roots in order, parents before children", () => {
    const document = doc([
      frame("f", ["a", "b"]),
      rect("a", { parentId: "f" }),
      rect("b", { parentId: "f" }),
      rect("root"),
    ])
    const list = buildRenderList(document)
    expect(list.map((entry) => entry.id)).toEqual(["f", "a", "b", "root"])
    expect(list.map((entry) => entry.depth)).toEqual([0, 1, 1, 0])
  })

  test("child matrices compose the parent transform", () => {
    const document = doc([
      frame("f", ["a"], { transform: { x: 10, y: 0, width: 100, height: 100, rotation: 0 } }),
      rect("a", { parentId: "f", transform: { x: 5, y: 0, width: 10, height: 10, rotation: 0 } }),
    ])
    const child = buildRenderList(document).find((entry) => entry.id === "a")
    expect(child).toBeDefined()
    if (!child) return
    expect(applyToPoint(child.matrix, { x: 0, y: 0 })).toEqual({ x: 15, y: 0 })
  })

  test("hidden and locked nodes stay in the list for the renderer to decide", () => {
    const document = doc([rect("a", { visible: false }), rect("b", { locked: true })])
    const list = buildRenderList(document)
    expect(list.find((entry) => entry.id === "a")?.node.visible).toBe(false)
    expect(list.find((entry) => entry.id === "b")?.node.locked).toBe(true)
  })

  test("an unknown reference fails fast instead of rendering nothing", () => {
    expect(() => buildRenderList(doc([frame("f", ["ghost"])]))).toThrow(DesignDocumentError)
  })
})
