/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { DesignDocumentError } from "../model/errors"
import { doc, frame, rect } from "../model/fixtures"
import { projectDocument } from "./project"

describe("design projection", () => {
  test("builds the hierarchy in childIds order", () => {
    const document = doc([
      frame("f", ["b", "a"]),
      rect("a", { parentId: "f" }),
      rect("b", { parentId: "f" }),
      rect("root"),
    ])
    const tree = projectDocument(document)
    expect(tree.map((item) => item.id)).toEqual(["f", "root"])
    expect(tree[0]?.children.map((item) => item.id)).toEqual(["b", "a"])
  })

  test("a dangling reference throws instead of rendering a partial scene", () => {
    expect(() => projectDocument(doc([frame("f", ["ghost"])]))).toThrow(DesignDocumentError)
  })
})
