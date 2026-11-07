/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { drawRectangle, layerRows, openStudio, seedCanvas, selectedIds } from "./studio-helpers"

// #1063 point 1: an element can be deleted three ways — the dock button, the
// canvas context menu and the Delete key — each one history entry.

test.describe("Design studio — delete an element", () => {
  test("the dock button deletes the selection and is disabled without one", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    const button = page.locator("[data-design-studio-delete]")
    await expect(button).toBeDisabled()
    await drawRectangle(page, { x: 80, y: 320 })
    await expect(layerRows(page)).toHaveCount(3)
    await expect(button).toBeEnabled()
    await button.click()
    await expect(layerRows(page)).toHaveCount(2)
    await expect(button).toBeDisabled()
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
