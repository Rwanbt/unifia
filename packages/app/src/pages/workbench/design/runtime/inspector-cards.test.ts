/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { createDesignDocument } from "../model/document"
import { applyCommand } from "../model/reducer"
import { designInspectorCards } from "./inspector-cards"

const t = (key: string, params?: Record<string, string | number>) =>
  (en as Record<string, string>)[key]!.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name]))

function documentWithRectangle() {
  const empty = createDesignDocument("doc", "Canvas")
  const next = applyCommand(empty, {
    kind: "insertNode",
    parentId: null,
    node: {
      id: "r1",
      name: "Card",
      type: "rectangle",
      parentId: null,
      visible: true,
      locked: false,
      transform: { x: 10.126, y: 20, width: 100, height: 50, rotation: 0 },
    },
  })
  return next
}

describe("designInspectorCards", () => {
  test("NoSelection_ShowsTheEmptyHead", () => {
    const cards = designInspectorCards(createDesignDocument("doc", "Canvas"), [], t)
    expect(cards).toEqual([{ kind: "head", title: "No selection", description: "Select an element on the canvas or in Layers." }])
  })

  test("OneNode_ShowsItsNameAndGeometry", () => {
    const [card] = designInspectorCards(documentWithRectangle(), ["r1"], t)
    expect(card).toMatchObject({ title: "Card" })
    const rows = Object.fromEntries(inspectorRows(card!).map((row) => [row.label, row.value]))
    expect(rows).toMatchObject({ Type: "rectangle", Position: "10.13, 20", Size: "100 × 50", Visible: "Yes", Locked: "No" })
  })

  test("SeveralNodes_ShowTheCount", () => {
    const cards = designInspectorCards(documentWithRectangle(), ["r1", "r1"], t)
    expect(cards).toEqual([{ title: "2 elements selected" }])
  })

  test("SelectedIdMissingFromDocument_IsTreatedAsNoSelection", () => {
    const cards = designInspectorCards(createDesignDocument("doc", "Canvas"), ["ghost"], t)
    expect(cards[0]).toMatchObject({ kind: "head" })
  })
})
