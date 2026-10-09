// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

// The palette keeps the rows of the previous search on screen while the next search runs.
// A click on one of those rows belongs to the old query, so it must not open that file.
// The next search is held open here, so the window is deterministic instead of a race.
test("a click on a row from the previous search does not open that file", async ({ page, gotoSession }) => {
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

  // First search: its rows become the stale rows shown during the next search.
  await input.fill("src")
  const stale = dialog.locator('[data-slot="list-item"][data-key^="file:"]:not([data-key="file:package.json"])').first()
  await expect(stale).toBeVisible({ timeout: 30_000 })
  const staleKey = await stale.getAttribute("data-key")
  const staleName = (staleKey ?? "").replace(/^file:/, "").split("/").pop() ?? ""
  expect(staleName).not.toBe("")

  // Second search: hold its response, then click a row that still shows the first search.
  holdSearch = true
  gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await input.fill("package.json")
  await expect(stale).toBeVisible()
  await stale.click()

  holdSearch = false
  release()

  // The palette stays open, the search for this query lands, and the stale file is not opened.
  await expect(dialog.locator('[data-slot="list-item"][data-key="file:package.json"]')).toBeVisible({ timeout: 30_000 })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole("tab", { name: staleName, exact: true })).toHaveCount(0)
})
