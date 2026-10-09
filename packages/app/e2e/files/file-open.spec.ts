import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("can open a file tab from the search palette", async ({ page, gotoSession }) => {
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
  await input.fill("package.json")

  // The palette keeps the previous results on screen while the search runs, so the
  // first file row can belong to an older query: wait for the row that is this file.
  const item = dialog.locator('[data-slot="list-item"][data-key="file:package.json"]')
  await expect(item).toBeVisible({ timeout: 30_000 })
  await item.click()

  await expect(dialog).toHaveCount(0)

  await expect(page.getByRole("tab", { name: "package.json" }).first()).toBeVisible()
})
