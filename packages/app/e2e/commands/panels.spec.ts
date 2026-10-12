/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { modKey } from "../utils"

const expanded = async (el: { getAttribute: (name: string) => Promise<string | null> }) => {
  const value = await el.getAttribute("aria-expanded")
  if (value !== "true" && value !== "false") throw new Error(`Expected aria-expanded to be true|false, got: ${value}`)
  return value === "true"
}

test("review panel can be toggled via keybind", async ({ page, gotoSession }) => {
  await gotoSession()
  await page.getByRole("radio", { name: "Editor" }).click()

  // v110: review and file-tree share one InspectorFrame pane now (session-side-panel.tsx).
  const reviewPanel = page.locator('[data-v110="inspector-content"]')

  const reviewToggle = page.locator('[data-v110="inspector-toggle"]')
  await expect(reviewToggle).toBeVisible()
  if (await expanded(reviewToggle)) await reviewToggle.click()
  await expect(reviewToggle).toHaveAttribute("aria-expanded", "false")
  await expect(reviewPanel).toHaveAttribute("aria-hidden", "true")

  await page.keyboard.press(`${modKey}+Shift+R`)
  await expect(reviewToggle).toHaveAttribute("aria-expanded", "true")
  await expect(reviewPanel).toHaveAttribute("aria-hidden", "false")
  await expect(page.locator('[data-v110-tab="inspector"]')).toHaveAttribute("aria-selected", "true")

  await page.keyboard.press(`${modKey}+Shift+R`)
  await expect(reviewToggle).toHaveAttribute("aria-expanded", "false")
  await expect(reviewPanel).toHaveAttribute("aria-hidden", "true")
})
