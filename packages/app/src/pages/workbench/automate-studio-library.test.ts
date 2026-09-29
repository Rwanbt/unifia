/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const LIBRARY_SOURCE = resolve(import.meta.dir, "automate-studio-library.tsx")
const librarySource = readFileSync(LIBRARY_SOURCE, "utf8")

describe("AutomateStudioLibrary smoke test (static)", () => {
  test("exports the SolidJS component", () => {
    expect(librarySource).toMatch(/export\s+function\s+AutomateStudioLibrary\s*\(/)
  })

  test("exports DEFAULT_LIBRARY_CATEGORIES covering all 15 NodeFamily types", () => {
    // Phase 8 slice 5: the library surfaces the canonical
    // NodeFamilySchema enum (15 families grouped into Triggers,
    // Control flow, Tools, Human, Misc). A future schema bump that
    // forgets to update the library breaks this test.
    expect(librarySource).toMatch(/export\s+const\s+DEFAULT_LIBRARY_CATEGORIES/)
    const families = [
      "trigger.manual",
      "trigger.schedule",
      "control.if",
      "control.switch",
      "control.parallel",
      "control.merge",
      "control.map",
      "control.repeat",
      "control.while",
      "control.child",
      "tool.http",
      "tool.transform",
      "human.approval",
      "wait",
    ]
    for (const family of families) {
      expect(librarySource).toContain(`family: "${family}"`)
    }
  })

  test("renders the 5 expected category headers", () => {
    expect(librarySource).toMatch(/category:\s*"Triggers"/)
    expect(librarySource).toMatch(/category:\s*"Control flow"/)
    expect(librarySource).toMatch(/category:\s*"Tools"/)
    expect(librarySource).toMatch(/category:\s*"Human"/)
    expect(librarySource).toMatch(/category:\s*"Misc"/)
  })

  test("filters entries via a search input", () => {
    // The filter input lives at the top of the library, filters by
    // label OR family, and collapses empty groups.
    expect(librarySource).toMatch(/data-automate-studio-library-search/)
    expect(librarySource).toMatch(/entry\.label\.toLowerCase\(\)\.includes\(needle\)/)
    expect(librarySource).toMatch(/entry\.family\.toLowerCase\(\)\.includes\(needle\)/)
  })

  test("emits onAdd with the picked entry on click", () => {
    expect(librarySource).toMatch(/data-automate-studio-library-entry=/)
    expect(librarySource).toMatch(/props\.onAdd\?\.\(entry\)/)
  })

  test("renders an empty state when the filter excludes everything", () => {
    expect(librarySource).toMatch(/data-automate-studio-library-empty/)
  })

  test("shows a family-count chip in the header", () => {
    expect(librarySource).toMatch(/data-automate-studio-library-count/)
  })
})
