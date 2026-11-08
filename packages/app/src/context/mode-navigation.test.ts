/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { uniqueSections, type NavSection } from "./mode-navigation"

const section = (id: string, label: string): NavSection => ({
  id,
  titleKey: `title.${id}`,
  rows: [{ id: "row", glyph: "▧", label }],
})

describe("uniqueSections", () => {
  test("UniqueSections_TwoSurfaceInstances_ShowEachSectionOnce", () => {
    const first = [section("design.pages", "Page 1"), section("design.system", "none")]
    const second = [section("design.pages", "Page 2"), section("design.system", "none")]
    const result = uniqueSections([...first, ...second])
    expect(result.map((item) => item.id)).toEqual(["design.pages", "design.system"])
  })

  test("UniqueSections_DuplicateIds_KeepTheLatestPublication", () => {
    const result = uniqueSections([section("design.pages", "Old"), section("design.pages", "New")])
    expect(result).toHaveLength(1)
    expect(result[0]!.rows[0]!.label).toBe("New")
  })

  test("UniqueSections_DistinctIds_KeepTheirOrder", () => {
    const sections = [section("a", "1"), section("b", "2"), section("c", "3")]
    expect(uniqueSections(sections)).toEqual(sections)
  })
})
