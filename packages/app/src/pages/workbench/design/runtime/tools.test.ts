/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { draftRect, draftToNode, isDraftUsable, type DesignDraft } from "./tools"

describe("design tools", () => {
  test("draftRect normalizes any drag direction", () => {
    expect(draftRect({ x: 120, y: 80 }, { x: 20, y: 30 })).toEqual({ x: 20, y: 30, width: 100, height: 50 })
  })

  test("a click without a drag is not usable, a thin drag is", () => {
    const click: DesignDraft = { kind: "rectangle", rect: { x: 0, y: 0, width: 1, height: 1 } }
    expect(isDraftUsable(click)).toBe(false)
    const thin: DesignDraft = { kind: "rectangle", rect: { x: 0, y: 0, width: 0, height: 40 } }
    expect(isDraftUsable(thin)).toBe(true)
    const shortLine: DesignDraft = { kind: "line", start: { x: 0, y: 0 }, end: { x: 2, y: 2 } }
    expect(isDraftUsable(shortLine)).toBe(false)
    const singlePoint: DesignDraft = { kind: "path", points: [{ x: 0, y: 0 }] }
    expect(isDraftUsable(singlePoint)).toBe(false)
  })

  test("rectangle and ellipse drafts map to canonical nodes", () => {
    const rect = draftToNode({ kind: "rectangle", rect: { x: 10, y: 20, width: 100, height: 50 } }, "r1")
    expect(rect).toMatchObject({ id: "r1", type: "rectangle", transform: { x: 10, y: 20, width: 100, height: 50 } })
    const ellipse = draftToNode({ kind: "ellipse", rect: { x: 10, y: 20, width: 100, height: 50 } }, "e1")
    expect(ellipse).toMatchObject({ id: "e1", type: "ellipse" })
  })

  test("line drafts keep local points and the drag direction", () => {
    const line = draftToNode({ kind: "line", start: { x: 300, y: 300 }, end: { x: 240, y: 260 } }, "l1")
    expect(line).toMatchObject({
      id: "l1",
      type: "line",
      transform: { x: 300, y: 300, width: 60, height: 40, rotation: 0 },
      points: [
        { x: 0, y: 0 },
        { x: -60, y: -40 },
      ],
    })
  })

  test("pen drafts map to a validated path with a bounding-box transform", () => {
    const path = draftToNode(
      {
        kind: "path",
        points: [
          { x: 400, y: 400 },
          { x: 460, y: 400 },
          { x: 460, y: 460 },
        ],
      },
      "p1",
    )
    expect(path).toMatchObject({
      id: "p1",
      type: "path",
      transform: { x: 400, y: 400, width: 60, height: 60, rotation: 0 },
      d: "M 0 0 L 60 0 L 60 60",
    })
    expect(draftToNode({ kind: "path", points: [{ x: 0, y: 0 }] }, "p2")).toBeUndefined()
  })
})
