/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { designNavSections } from "./nav-sections"

describe("designNavSections", () => {
  test("Pages_ListsTheEditedDocumentOnly", () => {
    const [pages] = designNavSections({ pageName: "Canvas", catalogs: [] })
    expect(pages!.rows.map((row) => row.label)).toEqual(["Canvas"])
  })
  test("NoCatalog_ShowsTheEmptyLineNotDemoTokens", () => {
    const [, system] = designNavSections({ pageName: "Canvas", catalogs: [] })
    expect(system!.rows).toEqual([])
    expect(system!.emptyKey).toBe("design.studio.system.empty")
  })
  test("Catalogs_AreListedByNameAndVersion", () => {
    const catalogs = [{ id: "ds", name: "Unifia", version: "1.2.0", tokens: { colors: {} } }]
    expect(designNavSections({ pageName: "x", catalogs })[1]!.rows.map((row) => row.label)).toEqual(["Unifia 1.2.0"])
  })
  test("InformationalRows_HaveNoAction", () => {
    const sections = designNavSections({ pageName: "x", catalogs: [{ id: "ds", name: "A", version: "1", tokens: { colors: {} } }] })
    expect(sections.flatMap((section) => section.rows).every((row) => row.onSelect === undefined)).toBe(true)
  })
})
