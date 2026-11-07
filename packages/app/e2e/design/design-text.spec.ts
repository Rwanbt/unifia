/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { layerRows, openStudio, seedCanvas, selectedIds } from "./studio-helpers"

// #1063 point 3: the Text tool places a text, Modify edits its content,
// font, size and alignment; each edit is one undoable command.

test.describe("Design studio — text", () => {
  test("place a text with the T key, then edit content, font, size and alignment", async ({ page, project, backend }) => {
    await seedCanvas(project)
    await openStudio(page, project.directory, backend.url)
    await page.locator("[data-design-canvas-tab]").focus()
    await page.keyboard.press("t")
    await expect(page.locator('[data-design-tool="text"]')).toHaveAttribute("aria-pressed", "true")

    const box = (await page.locator("[data-design-canvas]").boundingBox())!
    await page.mouse.click(box.x + 120, box.y + 360)
    await expect(layerRows(page)).toHaveCount(3)
    expect(await selectedIds(page)).toHaveLength(1)
    // Back to Select, and Modify opens on the new text.
    await expect(page.locator('[data-design-tool="select"]')).toHaveAttribute("aria-pressed", "true")
    const panel = page.locator('[data-design-tool-panel="modify"]')
    await expect(panel.locator("[data-design-prop-row] code").first()).toHaveText("text")

    const content = panel.locator('[data-design-prop="props.text"] input')
    await expect(content).toHaveValue("Text")
    await content.fill("Bonjour")
    await content.press("Enter")
    await expect(content).toHaveValue("Bonjour")

    const font = panel.locator('[data-design-prop="props.font"] select')
    await expect(font).toHaveValue("Inter")
    await font.selectOption("Georgia")
    await expect(font).toHaveValue("Georgia")

    const size = panel.locator('[data-design-prop="props.fontSize"] input')
    await size.fill("28")
    await size.press("Enter")
    await expect(size).toHaveValue("28")

    const center = panel.locator('[data-design-text-align="center"]')
    await center.click()
    await expect(center).toHaveAttribute("aria-checked", "true")
    await expect(panel.locator('[data-design-text-align="left"]')).toHaveAttribute("aria-checked", "false")

    // The last edit is one history entry.
    await page.locator("[data-design-canvas-undo]").click()
    await expect(panel.locator('[data-design-text-align="left"]')).toHaveAttribute("aria-checked", "true")
    await expect(size).toHaveValue("28")
  })
})
