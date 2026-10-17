import { test, expect } from "../fixtures"
import { dropImage } from "../actions"
import { promptSelector } from "../selectors"

test("dropping an image file adds an attachment", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await dropImage(page, "drop.png")

  const img = page.locator('img[alt="drop.png"]').first()
  await expect(img).toBeVisible()

  const remove = page.getByRole("button", { name: "Remove attachment" }).first()
  await expect(remove).toBeVisible()

  await img.hover()
  await remove.click()
  await expect(page.locator('img[alt="drop.png"]')).toHaveCount(0)
})
