/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dragOnCanvas, openStudio, seedCanvas, selectedIds } from "./studio-helpers"

// #1063 point 2: the Line tool draws segments; "Convert to path" only turns
// the selected shape into an editable path, and is unavailable otherwise.

test.describe("Design studio — Line tool vs Convert to path", () => {
  test("convert is disabled without a shape, and converts a drawn line into a path", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    const convert = page.locator('[data-design-studio-tool="vector"]')
    await expect(convert).toBeDisabled()

    await page.locator('[data-design-tool="line"]').click()
    await dragOnCanvas(page, { x: 80, y: 320 }, { x: 240, y: 380 })
    expect(await selectedIds(page)).toHaveLength(1)
    await expect(convert).toBeEnabled()

    await page.locator('[data-design-studio-tool="inspect"]').click()
    const type = page.locator("[data-design-tool-panel-props] [data-design-prop-row] code").first()
    await expect(type).toHaveText("line")
    await convert.click()
    await expect(type).toHaveText("path")
    // A path is already editable anchor by anchor: nothing left to convert.
    await expect(convert).toBeDisabled()
  })
})
