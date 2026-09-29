/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SOURCE = resolve(import.meta.dir, "automate-studio-minimap.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("AutomateStudioMinimap smoke test (static)", () => {
  test("exports the SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateStudioMinimap\s*\(/)
  })

  test("renders one small rectangle per laid-out node", () => {
    expect(source).toMatch(/data-automate-studio-minimap-node=/)
  })

  test("distinguishes extra nodes from legacy steps via data-attribute + colour", () => {
    expect(source).toMatch(/data-automate-studio-minimap-node-extra=/)
    expect(source).toMatch(/isExtra\(\)\s*\?\s*"currentColor"/)
  })

  test("renders a viewport indicator that follows pan + zoom", () => {
    expect(source).toMatch(/data-automate-studio-minimap-viewport/)
    // Anti-regression: a future refactor that forgets the pan/zoom
    // inversion would make the indicator drift off the visible
    // area as the user pans.
    expect(source).toMatch(/visibleGraphX\s*=\s*-props\.viewport\.panX\s*\/\s*z/)
    expect(source).toMatch(/visibleGraphY\s*=\s*-props\.viewport\.panY\s*\/\s*z/)
  })

  test("calls onJumpTo when the user clicks the minimap (slice 9.5 hook)", () => {
    expect(source).toMatch(/onClick=/)
    expect(source).toMatch(/props\.onJumpTo\(/)
  })

  test("renders an aria-label for screen readers", () => {
    expect(source).toMatch(/aria-label=\{t\("workbench\.automate\.minimap\.label"\)\}/)
  })
})
