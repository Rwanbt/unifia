/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

test("multimode navigation keeps the route and projection aligned", async ({ page, directory, slug }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))

  const modes = ["work", "design", "automate"] as const
  for (const mode of modes) {
    await page.getByRole("button", { name: `${mode} mode` }).click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/${mode}(?:[/?#]|$)`))
    await expect(page.locator(`[data-workbench-mode="${mode}"]`).first()).toBeVisible()
  }

  await page.getByRole("button", { name: "code mode" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
  await expect(page.locator(`[data-workbench-mode="code"]`).first()).toBeVisible()
})

test("unknown mode never renders an empty projection", async ({ page, directory }) => {
  await page.goto(`${dirPath(directory)}/unknown-mode`)
  await expect(page.locator("[data-workbench-error], [data-workbench-mode=code]").first()).toBeVisible()
})
