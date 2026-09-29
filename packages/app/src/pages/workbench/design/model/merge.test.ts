/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, rect } from "./fixtures"
import { mergeDesignDocuments } from "./merge"

describe("design document merge", () => {
  test("appends roots, nodes and assets without touching the target", () => {
    const target = doc([rect("a")])
    const source = { ...doc([rect("b")]), assets: { img: { id: "img", kind: "image" } } }
    const merged = mergeDesignDocuments(target, source)
    expect(merged?.rootIds).toEqual(["a", "b"])
    expect(Object.keys(merged?.nodes ?? {})).toEqual(["a", "b"])
    expect(merged?.assets?.img?.id).toBe("img")
    expect(target.rootIds).toEqual(["a"])
    expect(target.assets).toBeUndefined()
  })

  test("refuses a node or asset id collision instead of dropping data", () => {
    expect(mergeDesignDocuments(doc([rect("a")]), doc([rect("a")]))).toBeUndefined()
    const withAsset = { ...doc([rect("a")]), assets: { img: { id: "img", kind: "image" } } }
    const withSameAsset = { ...doc([rect("b")]), assets: { img: { id: "img", kind: "image" } } }
    expect(mergeDesignDocuments(withAsset, withSameAsset)).toBeUndefined()
  })
})
