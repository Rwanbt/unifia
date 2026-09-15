/* SPDX-License-Identifier: MIT */

// Phase 12.6 — responsive contract for the Automate studio, family by family.
//
// The surface resolves its layout from the canonical v110 viewport
// classification (pages/workbench/automate-surface.tsx, slice 8.8):
//
//   desktop-wide / desktop-compact          -> three-column studio (canvas +
//                                              library column + inspector)
//   tablet-portrait / phone-portrait /
//   compact-landscape                       -> overlay layout: the SVG canvas
//                                              is replaced by the step list and
//                                              the library folds into an
//                                              accordion
//
// The studio needs a workflow definition, so the workbench mock now serves a
// real file body (fileContents) through readFiles; without it the surface
// stays on its honest empty state. Per family: the studio mounts, the canvas
// swaps for the step list exactly on the overlay families, the run bar and
// inspector stay reachable, no x-overflow and no console/page error.

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

test("automate studio swaps the canvas for the step list on overlay families", async ({ page, directory, gotoSession }) => {
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

  // Open the mocked definition; a parsed preview means the studio mounted.
  await page.locator(`[data-automate-definition="${DEFINITION_PATH}"] button`).click()
  await expect(page.locator('[data-automate-definition-preview="ok"]')).toBeVisible()

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

      await expect(page.locator('[data-automate-studio-run-bar]'), c.name + ": run bar").toBeVisible()
      // The aside is the panel root; the inner empty/selected divs share the
      // same attribute prefix, hence the tag-qualified selector.
      await expect(page.locator("aside[data-automate-studio-inspector]"), c.name + ": inspector").toBeVisible()

      if (c.mobile) {
        await expect(
          page.locator('[data-automate-studio-canvas]'),
          c.name + ": the SVG canvas is desktop-only",
        ).toHaveCount(0)
        const steps = page.locator('[data-automate-studio-step-list]')
        await expect(steps, c.name + ": step list replaces the canvas").toBeVisible()
        await expect(steps.locator('[data-automate-studio-step-list-entry]')).toHaveCount(2)
        await expect(
          page.locator('[data-automate-studio-library-accordion]'),
          c.name + ": library folds into the accordion",
        ).toBeVisible()
      } else {
        await expect(page.locator('[data-automate-studio-canvas]'), c.name + ": canvas").toBeVisible()
        await expect(
          page.locator('[data-automate-studio-step-list]'),
          c.name + ": step list is overlay-only",
        ).toHaveCount(0)
        await expect(
          page.locator('[data-automate-studio-library-accordion]'),
          c.name + ": library is a column, not an accordion",
        ).toHaveCount(0)
        await expect(page.locator('[data-automate-studio-library]'), c.name + ": library column").toBeVisible()
      }

      // Selecting the first step proves the studio is interactive on that
      // family, not merely mounted: the inspector leaves its empty state.
      const target = c.mobile
        ? page.locator('[data-automate-studio-step-list-entry="fetch"]')
        : page.locator('[data-automate-studio-node="fetch"]')
      await target.click()
      await expect(page.locator('[data-automate-studio-inspector-id="fetch"]')).toBeVisible()
    })
  }

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
