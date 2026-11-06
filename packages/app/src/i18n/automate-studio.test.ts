/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { CAPABILITY_CATALOGUE } from "@/pages/workbench/automate-studio-environment"
import { DEFAULT_LIBRARY_CATEGORIES } from "@/pages/workbench/automate-studio-library"
import { isAutomateStudioKey, tAutomateStudio, tAutomateStudioOr } from "./automate-studio"

// Every string the studio builds from runtime data (a family, a category, a
// capability) must have a key: a missing one silently shows English to a
// French user, which is exactly the bug this dictionary fixes.
describe("Automate studio strings", () => {
  const families = DEFAULT_LIBRARY_CATEGORIES.flatMap((group) => group.entries.map((entry) => entry.family))

  test("every library family, category and capability has a key", () => {
    for (const family of families) {
      expect(isAutomateStudioKey(`family.${family}.label`)).toBe(true)
      expect(isAutomateStudioKey(`family.${family}.description`)).toBe(true)
    }
    for (const group of DEFAULT_LIBRARY_CATEGORIES) expect(isAutomateStudioKey(`category.${group.category}`)).toBe(true)
    for (const cap of CAPABILITY_CATALOGUE) expect(isAutomateStudioKey(`capability.${cap.key}`)).toBe(true)
  })

  test("French is translated, not the English fallback", () => {
    expect(tAutomateStudio("fr", "family.human.approval.label")).toBe("Approbation humaine")
    expect(tAutomateStudio("fr", "run.approve")).toBe("Approuver")
    expect(tAutomateStudio("fr", "capability.workflow.run")).toBe("Lancer des workflows")
  })

  test("other locales fall back to English; unknown runtime keys fall back to the raw text", () => {
    expect(tAutomateStudio("de", "run.continue")).toBe("Continue")
    expect(tAutomateStudio("en", "run.waitingOn", { node: "gate" })).toBe("gate is waiting for you")
    expect(tAutomateStudioOr("fr", "family.custom.thing.label", "Custom")).toBe("Custom")
  })
})
