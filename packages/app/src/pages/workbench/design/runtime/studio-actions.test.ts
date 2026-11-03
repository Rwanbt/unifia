/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { parsePath } from "../model/path"
import { applyCommand } from "../model/reducer"
import { doc, expectError, frame, line, rect } from "../model/fixtures"
import type { TextNodeV1 } from "../model/schema"
import {
  designPages,
  duplicateIds,
  freehandPathNode,
  newPageFrame,
  shapeToPath,
  thinPoints,
} from "./studio-actions"

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

describe("vector: shapeToPath", () => {
  test("a rectangle becomes a closed path of its own size, same id and style", () => {
    const node = rect("r", { transform: { x: 5, y: 6, width: 40, height: 20, rotation: 0 }, style: { fill: "#ff0000" } })
    const path = shapeToPath(node)!
    expect(path.id).toBe("r")
    expect(path.type).toBe("path")
    expect(path.transform).toEqual(node.transform)
    expect(path.style).toEqual({ fill: "#ff0000" })
    const data = parsePath(path.d)!
    expect(data.start).toEqual({ x: 0, y: 0 })
    expect(data.segments.map((segment) => segment.to)).toEqual([
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ])
  })

  test("an ellipse becomes four cubic quarters that start and end at the top", () => {
    const node = { ...rect("e"), type: "ellipse" as const, transform: { x: 0, y: 0, width: 100, height: 50, rotation: 0 } }
    const data = parsePath(shapeToPath(node)!.d)!
    expect(data.segments).toHaveLength(4)
    expect(data.segments.every((segment) => segment.kind === "cubic")).toBe(true)
    expect(data.start).toEqual({ x: 50, y: 0 })
    expect(data.segments[3]!.to).toEqual({ x: 50, y: 0 })
  })

  test("a line keeps its stroke; frames are not convertible", () => {
    expect(shapeToPath(line("l", { stroke: "#123456" }))!.style?.stroke).toBe("#123456")
    expect(shapeToPath(frame("f"))).toBeUndefined()
  })

  test("replaceNode swaps it in place as one command", () => {
    const base = doc([rect("a"), rect("b")])
    const next = applyCommand(base, { kind: "replaceNode", node: shapeToPath(base.nodes.a!)! })
    expect(next.rootIds).toEqual(["a", "b"])
    expect(next.nodes.a!.type).toBe("path")
  })
})

describe("pencil / annotate", () => {
  test("thinPoints drops samples closer than the tolerance and keeps the end", () => {
    expect(thinPoints([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 3, y: 0 }, { x: 3.2, y: 0 }], 1.5)).toEqual([
      { x: 0, y: 0 },
      { x: 3.2, y: 0 },
    ])
  })

  test("a stroke becomes a path whose transform is its bounding box", () => {
    const node = freehandPathNode([{ x: 10, y: 10 }, { x: 20, y: 30 }, { x: 40, y: 20 }], "p", "pencil")!
    expect(node.transform).toMatchObject({ x: 10, y: 10 })
    expect(node.transform.width).toBeGreaterThan(0)
    expect(parsePath(node.d)!.start).toEqual({ x: 0, y: 0 })
    expect(node.name).toBe("Pencil")
  })

  test("annotations are red and named as such; a single point draws nothing", () => {
    const node = freehandPathNode([{ x: 0, y: 0 }, { x: 10, y: 10 }], "a", "annotate")!
    expect(node.name).toBe("Annotation")
    expect(node.style?.stroke).toBe("#e5484d")
    expect(freehandPathNode([{ x: 0, y: 0 }], "x", "pencil")).toBeUndefined()
  })
})

describe("pages and format", () => {
  test("a page is a top-level frame; new pages line up to the right", () => {
    const first = newPageFrame(doc([]), "p1", "mobile")
    expect(first.transform).toEqual({ x: 0, y: 0, width: 390, height: 844, rotation: 0 })
    const withFirst = applyCommand(doc([]), { kind: "insertNode", node: first, parentId: null })
    const second = newPageFrame(withFirst, "p2")
    expect(second.name).toBe("Page 2")
    expect(second.transform.x).toBe(390 + 80)
    expect(designPages(applyCommand(withFirst, { kind: "insertNode", node: second, parentId: null })).map((page) => page.id)).toEqual(["p1", "p2"])
  })

  test("duplicateIds covers the whole subtree", () => {
    const document = doc([frame("f", ["a"]), rect("a", { parentId: "f" })])
    let counter = 0
    const ids = duplicateIds(document, "f", () => `n${++counter}`)
    expect(ids).toEqual({ f: "n1", a: "n2" })
    expect(applyCommand(document, { kind: "duplicateNode", id: "f", ids }).rootIds).toEqual(["f", "n1"])
  })
})

describe("content commands", () => {
  test("updateStyle merges and removes keys", () => {
    const base = doc([rect("a", { style: { fill: "#000000", stroke: "#111111" } })])
    const next = applyCommand(base, { kind: "updateStyle", id: "a", style: { fill: "#ffffff", stroke: undefined } })
    expect((next.nodes.a as { style?: object }).style).toEqual({ fill: "#ffffff" })
  })

  test("updateStyle maps a line's stroke to the node, and refuses bad opacity", () => {
    const next = applyCommand(doc([line("l")]), { kind: "updateStyle", id: "l", style: { stroke: "#ff0000", strokeWidth: 3 } })
    expect(next.nodes.l).toMatchObject({ stroke: "#ff0000", strokeWidth: 3 })
    expect(expectError(() => applyCommand(doc([rect("a")]), { kind: "updateStyle", id: "a", style: { opacity: 2 } })).code).toBe("invalid-command")
  })

  test("updateText edits text nodes only; locked nodes refuse every edit", () => {
    const next = applyCommand(doc([text("t", "#000000")]), { kind: "updateText", id: "t", text: "Bye" })
    expect((next.nodes.t as TextNodeV1).text).toBe("Bye")
    expect(expectError(() => applyCommand(doc([rect("a")]), { kind: "updateText", id: "a", text: "x" })).code).toBe("invalid-command")
    expect(expectError(() => applyCommand(doc([rect("a", { locked: true })]), { kind: "updateStyle", id: "a", style: { fill: "#fff" } })).code).toBe("node-locked")
  })
})
