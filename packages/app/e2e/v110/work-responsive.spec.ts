/* SPDX-License-Identifier: MIT */

// Phase 12.5 — responsive contract for the Work surface, family by family.
//
// Work derives its panels from the native workbench bridge, so the web suite
// used to skip it (work-team-panels.spec.ts). This spec installs the
// established workbench mock (fixtures/workbench-mock) so the surface reaches
// its real connected shape, then certifies the shell on the five families:
// the surface mounts, the six v110 view tabs stay reachable and switch the
// content pane, the page never overflows horizontally, and no console or page
// error appears.
//
// One seeded navigation, then viewport resizes only (same pattern as
// a4-responsive): Work reacts to the space it receives through CSS, so the
// contract is about the surface, not about reloading the app five times.
//
// It is deliberately layout-only: this file proves reachability, not the
// Team content (that stays work-team-panels' job once the native bridge runs).

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"
import { overflow, track } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900 },
  { name: "desktop-compact-1024x768", width: 1024, height: 768 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "phone-portrait-390x844", width: 390, height: 844 },
  { name: "compact-landscape-844x390", width: 844, height: 390 },
]

test("work surface keeps its view shell reachable across the five families", async ({ page, directory, gotoSession }) => {
  await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
  // gotoSession seeds the worker backend (the registry-seeded one) as the
  // page's server; without it the app falls back to the unseeded harness
  // server and every Work boot logs a 503 on the models route.
  await gotoSession()

  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await page.goto(`${dirPath(directory)}/work`)
  // Mode surfaces render in the Split/Editor layouts only (Chat shows the
  // conversation alone, as in the maquette).
  await page.getByRole("radio", { name: "Editor" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()

  // Track after the last navigation: leaving the session page aborts the
  // app's in-flight provider refresh, which logs a "Failed to fetch" the
  // app itself causes. The gate is about the steady state and the resize
  // loop below, not about that deliberate navigation.
  const t = track(page)

  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })

      await expect(page.locator('[data-workbench-surface="work"]'), c.name + ": work surface").toBeVisible()
      // Poll instead of reading once: v110 CSS transitions can leave a
      // transient box while the shell reflows, and the contract is about
      // persistent overflow.
      await expect
        .poll(async () => (await overflow(page)).dx, { message: c.name + ": global x-overflow exceeds 6px" })
        .toBeLessThanOrEqual(6)

      // ADR-040: views are switched from the context panel, which is not on
      // screen at every width; the card itself must render the cockpit.
      await expect(page.locator('[data-v110="work-content"]')).toHaveAttribute("data-work-view-content", "overview")
      await expect(page.locator('[data-v110="work-grid"]'), c.name + ": cockpit grid").toBeVisible()
    })
  }

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
