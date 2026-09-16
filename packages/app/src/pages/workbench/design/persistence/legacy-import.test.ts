/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { DesignDocumentError } from "../model/errors"
import { importLegacySketch } from "./legacy-import"

const scene = {
  type: "excalidraw",
  version: 2,
  elements: [
    {
      id: "r1",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      angle: Math.PI / 2,
      strokeColor: "#111111",
      backgroundColor: "transparent",
      strokeWidth: 2,
      opacity: 50,
    },
    { id: "t1", type: "text", x: 0, y: 0, width: 80, height: 20, text: "Hello", strokeColor: "#222222" },
  ],
}

describe("legacy sketch import", () => {
  test("converts rectangles and text into a validated canonical document", () => {
    const result = importLegacySketch(scene, { id: "canvas", name: "Canvas" })
    expect(result.document.schemaVersion).toBe(2)
    expect(result.document.rootIds).toEqual(["r1", "t1"])
    const rect = result.document.nodes.r1
    expect(rect?.type).toBe("rectangle")
    expect(rect?.transform.width).toBe(100)
    expect(rect?.transform.rotation).toBeCloseTo(90, 10)
    expect(result.document.nodes.t1?.type).toBe("text")
    expect(result.skipped).toEqual([])
  })

  test("frames own the elements that declare their frameId", () => {
    const result = importLegacySketch({
      elements: [
        { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 },
        { id: "c1", type: "rectangle", x: 10, y: 10, width: 20, height: 20, frameId: "f1" },
      ],
    })
    expect(result.document.rootIds).toEqual(["f1"])
    expect(result.document.nodes.c1?.parentId).toBe("f1")
    const frame = result.document.nodes.f1
    expect(frame?.type === "frame" ? frame.childIds : []).toEqual(["c1"])
  })

  test("maps arrows to lines with an approximation note", () => {
    const result = importLegacySketch({
      elements: [
        {
          id: "a1",
          type: "arrow",
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          points: [
            [0, 0],
            [50, 50],
          ],
          strokeColor: "#333333",
        },
      ],
    })
    expect(result.document.nodes.a1?.type).toBe("line")
    expect(result.approximated.join(" ")).toContain("arrow heads")
  })

  test("maps freedraw strokes to canonical paths", () => {
    const result = importLegacySketch({
      elements: [
        {
          id: "d1",
          type: "freedraw",
          x: 0,
          y: 0,
          width: 30,
          height: 30,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 20 },
            { x: 30, y: 30 },
          ],
        },
      ],
    })
    const path = result.document.nodes.d1
    expect(path?.type).toBe("path")
    if (path?.type === "path") expect(path.d).toBe("M 0 0 L 10 20 L 30 30")
  })

  test("skips unsupported and duplicate elements, and reports them", () => {
    const result = importLegacySketch({
      elements: [
        { id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
        { id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
        { id: "x1", type: "magicframe", x: 0, y: 0, width: 10, height: 10 },
        { id: "g1", type: "embeddable", x: 0, y: 0, width: 10, height: 10 },
      ],
    })
    expect(result.document.rootIds).toEqual(["r1"])
    expect(result.skipped.map((entry) => entry.reason).sort()).toEqual([
      "duplicate id",
      'unsupported element type "embeddable"',
      'unsupported element type "magicframe"',
    ])
  })

  test("drops deleted elements without reporting them", () => {
    const result = importLegacySketch({
      elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: true }],
    })
    expect(result.document.rootIds).toEqual([])
    expect(result.skipped).toEqual([])
  })

  test("is deterministic", () => {
    const first = importLegacySketch(scene, { id: "canvas", name: "Canvas" })
    const second = importLegacySketch(scene, { id: "canvas", name: "Canvas" })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  test("refuses input that is not a sketch", () => {
    expect(() => importLegacySketch("nope")).toThrow(DesignDocumentError)
    try {
      importLegacySketch({ appState: {} })
      throw new Error("expected the import to be refused")
    } catch (error) {
      expect(error).toBeInstanceOf(DesignDocumentError)
      if (error instanceof DesignDocumentError) expect(error.code).toBe("invalid-legacy-snapshot")
    }
  })
})
