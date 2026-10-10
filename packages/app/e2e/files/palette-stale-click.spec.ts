// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

// The palette must not show the rows of the previous search while a new search runs: a row
// from an old query must not be clickable or committable. The new search is held open here,
// so the loading window is deterministic instead of a race.
test("rows of the previous search are gone while a new search loads", async ({ page, gotoSession }) => {
  let holdSearch = false
  let gate: Promise<void> = Promise.resolve()
  let release: () => void = () => undefined

  await page.route("**/find/file**", async (route) => {
    if (holdSearch) await gate
    await route.continue()
  })

  await gotoSession()
  await page.getByRole("radio", { name: "Split" }).click()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/open")

  const command = page.locator('[data-slash-id="file.open"]').first()
  await expect(command).toBeVisible()
  await page.keyboard.press("Enter")

  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder(/search files/i) })
    .first()
  await expect(dialog).toBeVisible()

  const input = dialog.getByRole("textbox").first()

  // First search: its rows are the ones that must disappear once the query changes.
  await input.fill("src")
  const staleRow = dialog.locator('[data-slot="list-item"][data-key^="file:"]:not([data-key="file:package.json"])').first()
  await expect(staleRow).toBeVisible({ timeout: 30_000 })
  const staleKey = (await staleRow.getAttribute("data-key")) ?? ""
  expect(staleKey).not.toBe("")

  // Second search: hold its answer. The rows of the first search must already be gone.
  holdSearch = true
  gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await input.fill("package.json")

  await expect(dialog.locator(`[data-slot="list-item"][data-key="${staleKey}"]`)).toHaveCount(0)
  await expect(dialog.locator('[data-slot="list-item"]')).toHaveCount(0)
  await expect(dialog.locator('[data-slot="list-scroll"]')).toHaveAttribute("aria-busy", "true")

  holdSearch = false
  release()

  // Once the answer for this query lands, its rows appear and the old ones stay gone.
  await expect(dialog.locator('[data-slot="list-item"][data-key="file:package.json"]')).toBeVisible({ timeout: 30_000 })
  await expect(dialog.locator(`[data-slot="list-item"][data-key="${staleKey}"]`)).toHaveCount(0)
})
