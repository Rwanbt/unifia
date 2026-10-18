/* SPDX-License-Identifier: MIT */

// #553 (UI13/UI14) — the export's in-flight state, pinned in the browser.
//
// The spec editor's export button documents a deliberate contract: while an
// export runs it keeps focus and marks itself `aria-disabled` instead of
// native `disabled` (a focused button that turns disabled drops focus to
// <body>, and the approval modal that can follow would then have no
// meaningful opener to hand focus back to), and a second click is refused by
// a guard. Neither behaviour had a browser test — every existing design spec
// only ever sees the settled states.
//
// The in-flight window is controlled from the page, not by a timer: the
// mock's `holdExport` keeps `exportArtifact` pending until
// `releaseHeldExport` runs, so the assertions race nothing.

import { test, expect } from "../fixtures"
import { readMockCalls, releaseHeldExport } from "../fixtures/workbench-mock"
import { openDesignSurface, submitExport } from "./surface"

const exportCalls = async (page: import("@playwright/test").Page) =>
  (await readMockCalls(page)).filter((call) => call.method === "exportArtifact").length

test("the export stays reachable while in flight and refuses a double submit", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openDesignSurface(page, directory, { holdExport: true })

  await submitExport(page)

  const button = page.locator("[data-design-export-render]")
  // In flight: marked aria-disabled (not disabled), the label switches, and
  // no result is claimed until the broker answers.
  await expect(button).toHaveAttribute("aria-disabled", "true")
  await expect(button).not.toContainText("rendu SVG")
  await expect(page.locator("[data-design-export-result]")).toHaveCount(0)

  // The guard refuses a second submit while the first is still pending.
  // Forced: Playwright's actionability treats aria-disabled as disabled, but a
  // real user's click still reaches the handler - which is exactly the click
  // the guard exists to refuse.
  await button.click({ force: true })
  expect(await exportCalls(page)).toBe(1)

  // Releasing the broker settles the surface and clears the in-flight marks.
  await releaseHeldExport(page)
  await expect(page.locator('[data-design-export-result="exported"]')).toBeVisible()
  await expect(button).not.toHaveAttribute("aria-disabled", "true")
  await expect(button).toContainText("rendu SVG")
  expect(await exportCalls(page)).toBe(1)
})
