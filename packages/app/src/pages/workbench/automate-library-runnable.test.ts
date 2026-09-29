/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { DEFAULT_LIBRARY_CATEGORIES, isRunnableLibraryFamily, RUNNABLE_LIBRARY_FAMILIES } from "./automate-studio-library"

const families = DEFAULT_LIBRARY_CATEGORIES.flatMap((group) => group.entries.map((entry) => entry.family))

describe("AutomateStudioLibrary_RunnableFamilies", () => {
  test("only manual trigger, approval and wait can be added", () => {
    expect([...RUNNABLE_LIBRARY_FAMILIES].sort()).toEqual(["human.approval", "trigger.manual", "wait"])
  })

  test("every runnable family is a library entry, so the set cannot drift from the catalogue", () => {
    for (const family of RUNNABLE_LIBRARY_FAMILIES) expect(families).toContain(family)
  })

  test("control, tool and schedule families are not addable", () => {
    for (const family of families.filter((f) => f.startsWith("control.") || f.startsWith("tool.") || f === "trigger.schedule")) {
      expect(isRunnableLibraryFamily(family)).toBe(false)
    }
  })
})
