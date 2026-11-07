/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { drawRectangle, layerRows, openStudio, seedCanvas, selectedIds } from "./studio-helpers"

// #1063 point 1: an element can be deleted three ways — the dock button, the
// canvas context menu and the Delete key — each one history entry.

test.describe("Design studio — delete an element", () => {
  test("the dock button deletes the selection, and asks for one when there is none", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    const button = page.locator("[data-design-studio-delete]")
    // ADR-100: never disabled; an empty press explains itself instead.
    await expect(button).toBeEnabled()
    await button.click()
    await expect(page.locator("[data-design-studio-notice]")).toHaveText("Select an element to delete")
    await expect(layerRows(page)).toHaveCount(2)
    await drawRectangle(page, { x: 80, y: 320 })
    await expect(layerRows(page)).toHaveCount(3)
    await button.click()
    await expect(layerRows(page)).toHaveCount(2)
    await page.locator("[data-design-canvas-undo]").click()
    await expect(layerRows(page)).toHaveCount(3)
  })

  test("right click on an element offers Delete", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    await drawRectangle(page, { x: 80, y: 320 })
    const drawn = await selectedIds(page)
    expect(drawn).toHaveLength(1)
    // Clear the selection first: the right click itself must select the node.
    await page.locator("[data-design-canvas-tab]").focus()
    await page.keyboard.press("Escape")
    expect(await selectedIds(page)).toEqual([])
    const box = (await page.locator("[data-design-canvas]").boundingBox())!
    await page.mouse.click(box.x + 130, box.y + 350, { button: "right" })
    await expect(page.locator("[data-design-context-menu]")).toBeVisible()
    expect(await selectedIds(page)).toEqual(drawn)
    await page.locator("[data-design-context-delete]").click()
    await expect(page.locator("[data-design-context-menu]")).toHaveCount(0)
    await expect(layerRows(page)).toHaveCount(2)
  })

  test("the Delete key removes the selection", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    await drawRectangle(page, { x: 80, y: 320 })
    await expect(layerRows(page)).toHaveCount(3)
    await page.locator("[data-design-canvas]").focus()
    await page.keyboard.press("Delete")
    await expect(layerRows(page)).toHaveCount(2)
    expect(await selectedIds(page)).toEqual([])
  })
})

// The dock wraps instead of scrolling: at every studio width, each control
// (Delete included, last in the strip) lies wholly inside the dock's box.
for (const width of [375, 768, 1280, 1440]) {
  test(`every dock control is fully visible at ${width} px`, async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 })
    // Measured in one frame and polled: the layout switches (studio → single)
    // right after the resize, so a box read before that would be stale.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const dock = document.querySelector("[data-design-studio-dock]")
          if (!dock) return ["no dock"]
          const box = dock.getBoundingClientRect()
          const controls = [...dock.querySelectorAll(":scope > button, :scope > [data-design-studio-snap]")]
          if (controls.length < 6) return [`only ${controls.length} controls`]
          return controls
            .map((control, index) => ({ index, rect: control.getBoundingClientRect() }))
            .filter(({ rect }) => rect.left < box.left - 0.5 || rect.right > box.right + 0.5 || rect.bottom > box.bottom + 0.5)
            .map(({ index }) => `control ${index} clipped`)
        }),
      )
      .toEqual([])
  })
}