/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

test("multimode navigation keeps the route and projection aligned", async ({ page, directory, slug }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))

  // ADR-1033: automate is not on the production rail; only work/design are
  // reachable through the mode buttons this test drives.
  const modes = ["work", "design"] as const
  for (const mode of modes) {
    await page.getByRole("button", { name: `${mode} mode` }).click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/${mode}(?:[/?#]|$)`))
    await expect(page.locator(`[data-workbench-mode="${mode}"]`).first()).toBeVisible()
    await expect(page.locator(`[data-workbench-chat="${mode}"]`)).toBeVisible()
    await expect(page.locator("[data-workbench-chat-input]")).toBeVisible()
    await page.locator("[data-workbench-chat-suggestion]").click()
    await expect(page.locator("[data-workbench-chat-input]")).not.toHaveValue("")
  }

  await page.getByRole("button", { name: "code mode" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
  await expect(page.locator(`[data-workbench-mode="code"]`).first()).toBeVisible()
})

test("mode rail exposes aria-pressed and a labeled navigation group (A11Y-001)", async ({ page, directory, slug }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))

  await expect(page.getByRole("navigation", { name: "Workspace modes" })).toBeVisible()
  await expect(page.getByRole("button", { name: "code mode", pressed: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "work mode", pressed: false })).toBeVisible()

  await page.getByRole("button", { name: "work mode" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/work(?:[/?#]|$)`))
  await expect(page.getByRole("button", { name: "work mode", pressed: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "code mode", pressed: false })).toBeVisible()
})

test("unknown mode never renders an empty projection", async ({ page, directory }) => {
  await page.goto(`${dirPath(directory)}/unknown-mode`)
  await expect(page.locator("[data-workbench-error], [data-workbench-mode=code]").first()).toBeVisible()
})

test("workbench surfaces fail closed before a native bridge is available", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)

  await page.getByRole("button", { name: "work mode" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()
  // No native bridge in this harness: the lifecycle sets phase=failed (an
  // explicit error), not phase=unavailable (never attempted) — UX-001, the
  // banner text must say so, not the generic "unavailable" copy.
  await expect(page.locator('[data-workbench-connection="failed"]')).toBeVisible()
  await expect(page.getByText(/workbench bridge connection failed/i)).toBeVisible()
  await expect(page.getByText("Chat remains available")).toBeVisible()
  await expect(page.locator("[data-workbench-operation]")).toHaveCount(11)
  await page.locator('[data-workbench-operation="export"]').click()
  await expect(page.locator("[data-workbench-export]")).toBeDisabled()

  await page.getByRole("button", { name: "design mode" }).click()
  await expect(page.locator('[data-workbench-surface="design"]')).toBeVisible()
  await page.locator("#workbench-design-spec").fill('{"id":"broken"}')
  await expect(page.locator("[data-workbench-diagnostics]")).toBeVisible()
})
