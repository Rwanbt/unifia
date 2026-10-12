/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { DEFAULT_LIBRARY_CATEGORIES, isRunnableLibraryFamily, RUNNABLE_LIBRARY_FAMILIES } from "./automate-studio-library"

const families = DEFAULT_LIBRARY_CATEGORIES.flatMap((group) => group.entries.map((entry) => entry.family))

describe("AutomateStudioLibrary_RunnableFamilies", () => {
  test("only the families with a runnable config can be added", () => {
    expect([...RUNNABLE_LIBRARY_FAMILIES].sort()).toEqual(["control.if", "control.merge", "human.approval", "trigger.manual", "wait"])
  })

  test("every runnable family is a library entry, so the set cannot drift from the catalogue", () => {
    for (const family of RUNNABLE_LIBRARY_FAMILIES) expect(families).toContain(family)
  })

  test("the other control, tool and schedule families are not addable", () => {
    const configured = new Set(["control.if", "control.merge"])
    for (const family of families.filter((f) => (f.startsWith("control.") && !configured.has(f)) || f.startsWith("tool.") || f === "trigger.schedule")) {
      expect(isRunnableLibraryFamily(family)).toBe(false)
    }
  })
})
