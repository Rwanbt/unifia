/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { automateInspectorCards } from "./automate-inspector-cards"

const t = (key: string, params?: Record<string, string | number>) =>
  (en as Record<string, string>)[key]!.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name]))

const selection = {
  node: { id: "step-2", label: "tool.http", requiresApproval: true },
  index: 1,
  x: 120.4,
  y: 80,
  overridden: true,
  outgoing: ["step-3"],
  incoming: ["step-1", "step-0"],
}

describe("automateInspectorCards", () => {
  test("NothingSelected_ExplainsHowToSelect", () => {
    expect(automateInspectorCards(undefined, 3, t)).toEqual([
      { title: "Inspector", description: "Select a node in the canvas to inspect its metadata." },
    ])
  })

  test("SelectedNode_ListsItsRealMetadata", () => {
    const [card] = automateInspectorCards(selection, 3, t)
    const rows = Object.fromEntries(inspectorRows(card!).map((row) => [row.label, row.value]))
    expect(card).toMatchObject({ title: "tool.http" })
    expect(rows).toEqual({
      Identifier: "step-2",
      Position: "Step 2 of 3",
      Coordinates: "x 120, y 80 (dragged)",
      Approval: "Required",
      "Connects to": "step-3",
      "Connected from": "step-1, step-0",
    })
  })

  test("NodeWithoutEdgesOrCoordinates_OmitsThoseRows", () => {
    const [card] = automateInspectorCards({ ...selection, x: undefined, y: undefined, outgoing: [], incoming: [], overridden: false }, 3, t)
    const labels = inspectorRows(card!).map((row) => row.label)
    expect(labels).toEqual(["Identifier", "Position", "Approval"])
  })
})
