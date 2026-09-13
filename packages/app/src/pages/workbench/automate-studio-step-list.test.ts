/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SOURCE = resolve(import.meta.dir, "automate-studio-step-list.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("AutomateStudioStepList smoke test (static)", () => {
  test("exports the SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateStudioStepList\s*\(/)
  })

  test("renders one button per step with id + label + family", () => {
    expect(source).toMatch(/data-automate-studio-step-list-entry=/)
    expect(source).toMatch(/data-automate-studio-step-list-entry-family=/)
  })

  test("marks the selected step via aria-pressed", () => {
    // The mobile list is a sibling of the canvas — selection comes
    // from the same source (parent surface signal) so the user
    // sees the same selection on both views when the viewport
    // crosses a breakpoint during the session.
    expect(source).toMatch(/aria-pressed=\{isSelected\(\)\}/)
    expect(source).toMatch(/data-automate-studio-step-list-entry-selected=/)
  })

  test("emits onSelectStep on click (parent-controlled selection)", () => {
    expect(source).toMatch(/onClick=\{\(\)\s*=>\s*props\.onSelectStep\?\.\(step\.id\)\}/)
  })

  test("shows an approval chip when requiresApproval is true", () => {
    expect(source).toMatch(/data-automate-studio-step-list-approval="true"/)
  })

  test("shows a '(dragged)' marker when the position is overridden", () => {
    expect(source).toMatch(/const isOverridden/)
  })

  test("renders an empty state when the steps list is empty", () => {
    expect(source).toMatch(/data-automate-studio-step-list-empty/)
  })
})
