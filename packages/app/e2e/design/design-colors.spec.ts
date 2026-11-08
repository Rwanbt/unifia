/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { drawRectangle, openStudio, seedCanvas } from "./studio-helpers"

// #1063 point 4: Modify gives each element a fill and a stroke colour, with
// a picker bound to the same value as the hex field.

test.describe("Design studio — fill and stroke colours", () => {
  test("pickers set the fill and the stroke of the selected element", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    await drawRectangle(page, { x: 80, y: 320 })
    await page.locator('[data-design-studio-tool="modify"]').click()
    const panel = page.locator('[data-design-tool-panel="modify"]')
    const fill = panel.locator('[data-design-prop="props.fill"]')
    const stroke = panel.locator('[data-design-prop="props.stroke"]')

    // `fill()` on a colour input sets the value and fires change, like closing the picker.
    await fill.locator("[data-design-prop-picker]").fill("#ff3366")
    await expect(fill.locator('input[type="text"]')).toHaveValue("#ff3366")
    await stroke.locator("[data-design-prop-picker]").fill("#0055ff")
    await expect(stroke.locator('input[type="text"]')).toHaveValue("#0055ff")
    await expect(fill.locator("[data-design-prop-picker]")).toHaveValue("#ff3366")

    // The hex field drives the picker too, and each change is one undo step.
    await fill.locator('input[type="text"]').fill("#0F0")
    await fill.locator('input[type="text"]').press("Enter")
    await expect(fill.locator("[data-design-prop-picker]")).toHaveValue("#00ff00")
    await page.locator("[data-design-canvas-undo]").click()
    await expect(fill.locator('input[type="text"]')).toHaveValue("#ff3366")
    await expect(stroke.locator('input[type="text"]')).toHaveValue("#0055ff")
  })
})
