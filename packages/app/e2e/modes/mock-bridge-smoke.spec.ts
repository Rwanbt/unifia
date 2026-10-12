/* SPDX-License-Identifier: MIT */

import { expect, test } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

// Regression: QA-001 — the injected bridge must reach a connected surface.
// Found by /qa on 2026-08-28.
// Report: .gstack/qa-reports/qa-report-unifia-design-2026-08-28.md
test("mock bridge connects the Work surface without a reactive update loop", async ({ page, directory }) => {
  const pageErrors: Error[] = []
  page.on("pageerror", (error) => pageErrors.push(error))
  await installWorkbenchMock(page)
  await page.goto(`${dirPath(directory)}/work`)
  // The cockpit hides the connection banner once ready (ffe49ce40e); the
  // surface publishes the phase instead.
  await expect(page.locator('[data-workbench-surface="work"]')).toHaveAttribute("data-workbench-phase", "ready")
  await expect(page.locator("[data-workbench-connection]")).toHaveCount(0)
  await page.waitForTimeout(250)
  expect(pageErrors).toEqual([])
})
