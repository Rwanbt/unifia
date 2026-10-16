/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import type { Locator, Page } from "@playwright/test"
import { openDesignSurface } from "./surface"
import { DESIGN_CANVAS_FILE, visualDocument } from "./design-content.fixture"

// Capture the actual on-screen studio rectangle. Locator.screenshot() scrolls
// its target into view and changed the scroll/layout between the first load
// and reload on Linux. Page clip leaves the live surface where the UI laid it
// out; require its geometry and all pixels to settle before comparing loads.
async function capture(stage: Locator, page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const canvas = stage.locator("[data-design-canvas]")
  await expect(canvas).toHaveAttribute("data-design-canvas-status", "ready")
  let previous: { box: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>; pixels: Buffer } | undefined
  let unchanged = 0
  await expect.poll(async () => {
    const aligned = await stage.evaluate((el) => {
      const bounds = el.getBoundingClientRect()
      const panel = document.querySelector("[data-design-studio-panel]")?.getBoundingClientRect()
      const konva = el.querySelector("canvas")?.getBoundingClientRect()
      return !!panel && !!konva && bounds.width > 400 && bounds.height > 300 &&
        bounds.left >= panel.right - 2 &&
        Math.abs(konva.width - bounds.width) < 2 && Math.abs(konva.height - bounds.height) < 2
    })
    const box = aligned ? await stage.boundingBox() : null
    if (!box) return false
    const pixels = await page.screenshot({ clip: box, animations: "disabled", caret: "hide" })
    const same = !!previous && JSON.stringify(box) === JSON.stringify(previous.box) && pixels.equals(previous.pixels)
    unchanged = same ? unchanged + 1 : 0
    previous = { box, pixels }
    return unchanged >= 2
  }, { timeout: 15_000, intervals: [100, 250, 500] }).toBe(true)
  return previous!
}

// Sample the Konva *content* canvas, not CSS chrome. Proves that the negative
// oracle observes the saved fill color itself, rather than a layout change.
async function fillAt(stage: Locator) {
  return stage.locator("[data-design-canvas] canvas").first().evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Konva content canvas missing")
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Konva 2D context missing")
    const ratio = canvas.width / canvas.getBoundingClientRect().width
    return [...ctx.getImageData(Math.round(275 * ratio), Math.round(175 * ratio), 1, 1).data]
  })
}

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
  const first = await capture(stage, page)
  expect(await fillAt(stage)).toEqual([232, 90, 50, 255])
  await page.reload()
  await expect(layer).toBeVisible()
  await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()
  const second = await capture(stage, page)
  expect(second.box, "stage layout must survive reload").toEqual(first.box)
  expect(second.pixels.equals(first.pixels), "pinned content must survive reload without visual drift").toBe(true)
  expect(await fillAt(stage)).toEqual([232, 90, 50, 255])

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
  const third = await capture(stage, page)
  expect(third.box, "stage geometry must stay unchanged for the color oracle").toEqual(first.box)
  expect(await fillAt(stage)).toEqual([34, 74, 196, 255])
  expect(third.pixels.equals(first.pixels), "a changed layer fill must alter actual Canvas pixels").toBe(false)
})
