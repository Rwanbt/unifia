/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { memoryNavSections } from "./memory-nav-sections"

const t = (key: string) => key
const noop = () => undefined

describe("memoryNavSections", () => {
  test("Rows_AreTheRealViewsAndCounts_AndSearchIsGone", () => {
    const [section] = memoryNavSections({ surface: "note", noteCount: 12, backlinkCount: 3, onShowNotes: noop, onShowGraph: noop, onShowBacklinks: noop }, t)
    expect(section!.rows.map((row) => [row.id, row.badge, row.active])).toEqual([
      ["notes", "12", true],
      ["graph", undefined, false],
      ["backlinks", "3", undefined],
    ])
    expect(section!.rows.some((row) => row.id === "search")).toBe(false)
  })

  test("GraphSurface_MarksGraphActive", () => {
    const [section] = memoryNavSections({ surface: "graph", noteCount: 0, backlinkCount: 0, onShowNotes: noop, onShowGraph: noop, onShowBacklinks: noop }, t)
    expect(section!.rows.find((row) => row.active)?.id).toBe("graph")
  })

  test("EveryRow_HasAnAction", () => {
    const [section] = memoryNavSections({ surface: "note", noteCount: 0, backlinkCount: 0, onShowNotes: noop, onShowGraph: noop, onShowBacklinks: noop }, t)
    expect(section!.rows.every((row) => typeof row.onSelect === "function")).toBe(true)
  })
})
