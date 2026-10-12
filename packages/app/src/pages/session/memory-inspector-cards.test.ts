/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { inspectorActions, inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { memoryInspectorCards } from "./memory-inspector-cards"
import { parseMemoryNote } from "./memory-panel-model"

const t = (key: string, params?: Record<string, string | number>) =>
  (en as Record<string, string>)[key]!.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name]))

const note = parseMemoryNote(".unifia/memory/ideas/Plan.md", "# Plan\nSee [[Vision]] and [[Risks]] #roadmap #q4")

describe("memoryInspectorCards", () => {
  test("NoNoteOpen_ShowsTheHonestEmptyCard", () => {
    const cards = memoryInspectorCards({ note: undefined, location: "", backlinkCount: 0, attached: false, onToggleAttached: () => undefined }, t)
    expect(cards).toEqual([{ title: "Nothing to inspect", description: "Nothing is open in this mode yet." }])
  })

  test("OpenNote_ListsItsRealCounts", () => {
    const cards = memoryInspectorCards({ note, location: "ideas / Plan.md", modified: "modified 3 Sep", backlinkCount: 4, attached: false, onToggleAttached: () => undefined }, t)
    expect(cards[0]).toEqual({ title: "Plan", description: "ideas / Plan.md · modified 3 Sep" })
    const rows = Object.fromEntries(inspectorRows(cards[1]!).map((row) => [row.label, row.value]))
    expect(rows).toEqual({ Tags: "#roadmap #q4", Links: "2", Backlinks: "4" })
  })

  test("AttachAction_TogglesTheSessionContext", () => {
    let toggled = 0
    const attachedCards = memoryInspectorCards({ note, location: "x", backlinkCount: 0, attached: true, onToggleAttached: () => toggled++ }, t)
    const action = inspectorActions(attachedCards[2]!)[0]!
    expect(action.label).toBe("Remove from context")
    action.run?.()
    expect(toggled).toBe(1)
    const detached = memoryInspectorCards({ note, location: "x", backlinkCount: 0, attached: false, onToggleAttached: () => undefined }, t)
    expect(inspectorActions(detached[2]!)[0]!.label).toBe("Add to context")
  })
})
