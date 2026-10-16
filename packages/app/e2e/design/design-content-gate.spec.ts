/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { openDesignSurface } from "./surface"
import { DESIGN_CANVAS_FILE, visualDocument } from "./design-content.fixture"

// #729 — the live Canvas does NOT consume Workbench listArtifacts: it loads
// .unifia/design/canvas.design.json through the shipped SDK file.readRaw route.
// Seed the worker's real project via that same API, not a second UI-only mock.
test("Design screenshot sees the canonical saved canvas and fails on an internal fill change", async ({
  page,
  project,
}) => {
  await project.open({
    beforeGoto: async ({ sdk }) => {
      const saved = await sdk.file.write({ path: DESIGN_CANVAS_FILE, content: visualDocument("#e85a32") })
      expect(saved.data, "the fixture must be accepted by the real file API").toBeDefined()
    },
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await openDesignSurface(page, project.directory)
  const layer = page.locator('[data-design-layer-row="rc1-729-shape"]')
  await expect(layer).toBeVisible()
  await expect(page.locator('[data-design-layer-row="rc1-729-label"]')).toContainText("RC1 729 Layer Text")
  await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()

  const stage = page.locator("[data-design-studio-stage]")
  const first = await stage.screenshot({ animations: "disabled", caret: "hide" })
  await page.reload()
  await expect(layer).toBeVisible()
  await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()
  const second = await stage.screenshot({ animations: "disabled", caret: "hide" })
  expect(second.equals(first), "pinned content must survive reload without visual drift").toBe(true)

  // Negative oracle: modify only the canonical document, not the layout.
  // The next capture MUST change or the visual gate observes only chrome.
  const read = await project.sdk.file.readRaw({ path: DESIGN_CANVAS_FILE })
  expect(read.data?.stamp.hash).toBeTruthy()
  const changed = await project.sdk.file.write({
    path: DESIGN_CANVAS_FILE,
    content: visualDocument("#224ac4"),
    expectedHash: read.data!.stamp.hash,
  })
  expect(changed.data).toBeDefined()

  await page.reload()
  await expect(layer).toBeVisible()
  await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()
  const third = await stage.screenshot({ animations: "disabled", caret: "hide" })
  expect(third.equals(first), "a changed layer fill must alter actual Canvas pixels").toBe(false)
})
