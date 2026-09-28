/* SPDX-License-Identifier: MIT */

// Phase 12.6 + ADR-086 — responsive contract for the Automate flow studio,
// family by family.
//
// The surface resolves its layout from the canonical v110 viewport
// classification (pages/workbench/automate-surface.tsx):
//
//   desktop-wide / desktop-compact          -> studio: library column, flow
//                                              canvas, debugger
//   tablet-portrait / phone-portrait /
//   compact-landscape                       -> the canvas stays (like the
//                                              reference); the library opens
//                                              as a sheet from the zoom pill's
//                                              Nodes button
//
// The workbench mock serves a real file body (fileContents) through
// readFiles; the studio opens that workflow by itself. Per family: the canvas
// and run bar render, the library is a column or a sheet as expected,
// selecting a node opens its inspector, no x-overflow and no console/page
// error.

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"
import { overflow, track } from "./gate"

const DEFINITION_PATH = ".unifia/workflows/e2e-responsive-flow.json"
const DEFINITION = {
  id: "e2e-responsive-flow",
  version: 1,
  steps: [
    { id: "fetch", family: "io.http" },
    { id: "approve", family: "human.approval", requiresApproval: true },
  ],
}

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900, mobile: false },
  { name: "desktop-compact-1024x768", width: 1024, height: 768, mobile: false },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024, mobile: true },
  { name: "phone-portrait-390x844", width: 390, height: 844, mobile: true },
  { name: "compact-landscape-844x390", width: 844, height: 390, mobile: true },
]

test("automate studio keeps the canvas and moves the library into a sheet on overlay families", async ({ page, directory, gotoSession }) => {
  await installWorkbenchMock(page, {
    workspaceId: "mock-workspace-1",
    grants: ["workflow.run"],
    files: [{ path: DEFINITION_PATH, kind: "file" }],
    fileContents: { [DEFINITION_PATH]: JSON.stringify(DEFINITION) },
  })
  // Seeds the worker backend (the registry-seeded one) as the page's server.
  await gotoSession()

  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await page.goto(`${dirPath(directory)}/automate`)
  await expect(page.locator('[data-workbench-surface="automate"]')).toBeVisible()

  // The studio opens the only workflow file by itself.
  await expect(page.locator('[data-automate-studio-node="fetch"]')).toBeVisible()

  // Track after the last navigation: leaving the session page aborts the
  // app's in-flight provider refresh, which logs a "Failed to fetch" the
  // app itself causes. The gate is about the steady state and the resize
  // loop below, not about that deliberate navigation.
  const t = track(page)

  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })

      await expect
        .poll(async () => (await overflow(page)).dx, { message: c.name + ": global x-overflow exceeds 6px" })
        .toBeLessThanOrEqual(6)

      await expect(page.locator("[data-automate-studio-run-bar]"), c.name + ": run bar").toBeVisible()
      await expect(page.locator("[data-automate-studio-canvas]"), c.name + ": canvas").toBeVisible()

      if (c.mobile) {
        await expect(
          page.locator("[data-automate-studio-library]"),
          c.name + ": the library is a sheet, closed by default",
        ).toHaveCount(0)
        await page.locator("[data-automate-studio-nodes-toggle]").click()
        await expect(page.locator("[data-automate-studio-nodes-sheet] [data-automate-studio-library]")).toBeVisible()
        await page.locator("[data-automate-studio-library-collapse]").click()
        await expect(page.locator("[data-automate-studio-nodes-sheet]")).toHaveCount(0)
      } else {
        await expect(page.locator("[data-automate-studio-library]"), c.name + ": library column").toBeVisible()
        await expect(page.locator("[data-automate-studio-debug]"), c.name + ": debugger").toBeVisible()
      }

      // Selecting a node proves the studio is interactive on that family,
      // not merely mounted: its inspector opens.
      await page.locator('[data-automate-studio-node="fetch"]').click()
      await expect(page.locator('[data-automate-studio-inspector-id="fetch"]')).toBeVisible()
      await page.locator('[data-automate-studio-inspector-column] button').first().click()
    })
  }

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
