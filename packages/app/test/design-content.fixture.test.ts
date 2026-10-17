/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { designDocumentV1Schema } from "../src/pages/workbench/design/model/schema"
import { DESIGN_CANVAS_FILE, visualDocument } from "../e2e/design/design-content.fixture"

describe("RC1-729 Design visual fixture", () => {
  test("is a valid versioned workspace Canvas document with actual drawable layers", () => {
    const parsed = designDocumentV1Schema.parse(JSON.parse(visualDocument("#e85a32")))
    expect(DESIGN_CANVAS_FILE).toBe(".unifia/design/canvas.design.json")
    expect(parsed.id).toBe("canvas")
    expect(parsed.rootIds).toEqual(["rc1-729-shape", "rc1-729-label"])
    expect(parsed.nodes["rc1-729-shape"]?.type).toBe("rectangle")
    expect(parsed.nodes["rc1-729-label"]?.type).toBe("text")
  })

  test("a negative oracle changes only the renderable fill", () => {
    const first = JSON.parse(visualDocument("#e85a32"))
    const second = JSON.parse(visualDocument("#224ac4"))
    expect(first.nodes["rc1-729-shape"].style.fill).not.toBe(second.nodes["rc1-729-shape"].style.fill)
    second.nodes["rc1-729-shape"].style.fill = first.nodes["rc1-729-shape"].style.fill
    expect(second).toEqual(first)
  })
})