/* SPDX-License-Identifier: MIT */

import type { Page } from "@playwright/test"
import { expect } from "../fixtures"

export async function openInspector(page: Page, tab: "explorer" | "inspector") {
  await page.getByRole("radio", { name: "Editor", exact: true }).click()
  const toggle = page.locator('[data-v110="inspector-toggle"]')
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const frame = page.locator('[data-v110="inspector-frame"]')
  await expect(frame).toBeVisible()
  const selectedTab = frame.locator(`[data-v110-tab="${tab}"]`)
  await selectedTab.click()
  await expect(selectedTab).toHaveAttribute("aria-selected", "true")
}
