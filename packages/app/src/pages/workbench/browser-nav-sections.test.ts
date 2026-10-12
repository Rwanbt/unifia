/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { browserNavSections } from "./browser-nav-sections"
import { rememberVisited, visitedLabel } from "./design-browser-model"

describe("visited pages", () => {
  test("Remember_PutsTheLatestFirstWithoutDuplicates", () => {
    expect(rememberVisited(["https://a.dev/", "https://b.dev/"], "https://b.dev/")).toEqual(["https://b.dev/", "https://a.dev/"])
  })
  test("Remember_IsCapped", () => {
    const many = Array.from({ length: 60 }, (_, index) => `https://x${index}.dev/`)
    expect(rememberVisited(many, "https://new.dev/")).toHaveLength(50)
  })
  test("Label_IsHostAndPath", () => {
    expect(visitedLabel("https://docs.dev/guide/")).toBe("docs.dev/guide")
    expect(visitedLabel("https://docs.dev/")).toBe("docs.dev")
  })
})

describe("browserNavSections", () => {
  const t = (key: string) => key
  test("NoPageOpened_HasNoRowsAndAnEmptyLine", () => {
    const [history] = browserNavSections({ visited: [], current: undefined, onOpen: () => undefined }, t)
    expect(history!.rows).toEqual([])
    expect(history!.emptyKey).toBe("sidebar.nav.noHistory")
  })
  test("OpenedPages_AreRowsThatReopenAndMarkTheCurrentOne", () => {
    const opened: string[] = []
    const [history] = browserNavSections({ visited: ["https://a.dev/", "https://b.dev/x"], current: "https://b.dev/x", onOpen: (address) => opened.push(address) }, t)
    expect(history!.rows.map((row) => [row.label, row.active])).toEqual([
      ["a.dev", false],
      ["b.dev/x", true],
    ])
    history!.rows[0]!.onSelect?.()
    expect(opened).toEqual(["https://a.dev/"])
  })
})
