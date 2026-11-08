/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { openStudio, seedCanvas, selectedIds } from "./studio-helpers"

// #1063 point 5: "+ New page" asks for a format and creates an artboard of
// that size, listed under Pages and selected.

test.describe("Design studio — create a page", () => {
  test("New page offers the formats and creates an A4 artboard", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    const pagesBefore = await page.locator("[data-design-studio-page-actions]").count()

    await page.locator("[data-design-studio-page-add]").click()
    const menu = page.locator("[data-design-studio-page-add-menu]")
    await expect(menu.locator("[data-design-studio-page-add-preset]")).toHaveCount(5)
    await menu.locator('[data-design-studio-page-add-preset="a4"]').click()
    await expect(menu).toHaveCount(0)

    await expect(page.locator("[data-design-studio-page-actions]")).toHaveCount(pagesBefore + 1)
    const [id] = await selectedIds(page)
    expect(id).toBeTruthy()
    await expect(page.locator(`[data-design-studio-page="${id}"]`)).toHaveAttribute("data-active", "")

    await page.locator('[data-design-studio-tool="inspect"]').click()
    const panel = page.locator('[data-design-tool-panel="inspect"]')
    await expect(panel.locator('[data-design-prop="props.width"] input')).toHaveValue("794")
    await expect(panel.locator('[data-design-prop="props.height"] input')).toHaveValue("1123")
  })
})
