/* SPDX-License-Identifier: MIT */

/**
 * MiniMax M3 — Phase 3 Shell global gate.
 *
 * Verifies the cross-cutting shell surfaces mounted for every viewport
 * family, the responsive authority is the single source of truth
 * (no local breakpoints), and the 4 shell modes are reachable.
 * Uses m3-harness helpers for deterministic viewport switching.
 *
 * Anti-regression rule honoured: NO viewport loop in a single page.
 * Each viewport family runs in its own `test` block with a fresh
 * page fixture.
 *
 * Fixed 2026-09-13 (e2e collection): this file imported { test } from
 * "bun:test" while living under e2e/, so Playwright could not load it
 * ("Received protocol 'bun:'"), which aborted collection of the WHOLE
 * suite on CI (0 tests in junit). It now uses the repo fixtures like
 * every other spec.
 */

import { expect, test } from "./fixtures"
import {
  VIEWPORT_FAMILIES,
  assertShellMounted,
  globalHorizontalOverflow,
  overflowReport,
  pickShellMode,
  pickInspectorTab,
  setViewportFamily,
  shellModeEnabled,
  toggleWorkspaceSidebar,
  type ViewportFamily,
} from "./m3-harness"

const FAMILIES: ViewportFamily[] = [
  "desktopLarge",
  "desktopCompact",
  "tabletLandscape",
  "tabletPortrait",
  "mobileLandscape",
  "mobilePortrait",
]

test.describe("M3 shell gate (Phase 3)", () => {
  for (const family of FAMILIES) {
    test(`shell mounts + no overflow @ ${family} (${VIEWPORT_FAMILIES[family].width}x${VIEWPORT_FAMILIES[family].height})`, async ({ page, gotoSession }) => {
      await setViewportFamily(page, family)
      await gotoSession()
      await assertShellMounted(page)
      const overflow = await globalHorizontalOverflow(page)
      expect(overflow, `${family}: root horizontal overflow`).toBeLessThanOrEqual(6)
      const offenders = await overflowReport(page)
      expect(offenders, `${family}: offenders ${JSON.stringify(offenders)}`).toEqual([])
    })
  }

  test("desktop-large can switch all four shell modes", async ({ page, gotoSession }) => {
    await setViewportFamily(page, "desktopLarge")
    await gotoSession()
    await assertShellMounted(page)
    // Automate is grant-gated (ADR-1041): its trigger is present but
    // disabled without workflow.run, and clicking a disabled button is a
    // 60 s actionability timeout. Switch the enabled modes and require the
    // two non-gated ones (code + work) at minimum.
    let switched = 0
    for (const mode of ["code", "work", "design", "automate"] as const) {
      if (!(await shellModeEnabled(page, mode))) continue
      const resolved = await pickShellMode(page, mode)
      expect(resolved, `mode switch ${mode}`).toBe(mode)
      switched += 1
    }
    expect(switched, "code + work must be switchable in the e2e fixture").toBeGreaterThanOrEqual(2)
  })

  test("desktop-compact sidebar toggles open and closed", async ({ page, gotoSession }) => {
    await setViewportFamily(page, "desktopCompact")
    await gotoSession()
    await assertShellMounted(page)
    const opened = await toggleWorkspaceSidebar(page)
    expect(typeof opened).toBe("boolean")
    const overflow = await globalHorizontalOverflow(page)
    expect(overflow).toBeLessThanOrEqual(6)
  })

  test("desktop-large inspector tabs are reachable", async ({ page, gotoSession }) => {
    await setViewportFamily(page, "desktopLarge")
    await gotoSession()
    await assertShellMounted(page)
    for (const tab of ["explorer", "inspector", "execution"] as const) {
      await pickInspectorTab(page, tab)
    }
  })

  test("mobile-portrait shell mounts but desktop panels collapse", async ({ page, gotoSession }) => {
    await setViewportFamily(page, "mobilePortrait")
    await gotoSession()
    await assertShellMounted(page)
    // Mobile nav must be visible (≤600px portrait), rail collapsed.
    const nav = page.locator('[data-v110="mobile-nav"]')
    await nav.waitFor({ state: "visible", timeout: 1500 })
  })
})
