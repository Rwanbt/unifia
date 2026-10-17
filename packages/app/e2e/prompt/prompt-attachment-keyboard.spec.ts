/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dropImage } from "../actions"
import { promptSelector } from "../selectors"

// V08 (issue #553, criterion 5): keyboard and escape behaviour of the prompt
// attachment surface.
//
// The remove control is a real <button>, but it is hidden with `opacity-0` and
// revealed by `group-hover:opacity-100` next to `focus-visible:opacity-100`
// (packages/app/src/components/prompt-input/image-attachments.tsx). A keyboard
// user therefore only ever sees it if the `focus-visible` half fires in a real
// browser — Tailwind wraps every `hover:` variant in `@media (hover: hover)`,
// so the hover half is no help to them. That is what this spec certifies.
test("keyboard focus reveals the attachment remove control and Enter removes it", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await dropImage(page, "keyboard.png")

  const remove = page.getByRole("button", { name: "Remove attachment" }).first()
  await expect(remove).toHaveCount(1)
  // Nothing points at the control, so it must start hidden.
  await expect(remove).toHaveCSS("opacity", "0")

  await remove.focus()
  await expect(remove).toBeFocused()
  expect(await remove.evaluate((node) => node.matches(":focus-visible"))).toBe(true)
  // The reveal has to be reached, not merely declared: the control must become
  // visually operable, and the transition has to settle on the final value.
  await expect(remove).toHaveCSS("opacity", "1")

  await page.keyboard.press("Enter")
  await expect(page.locator('img[alt="keyboard.png"]')).toHaveCount(0)
})

test("Escape closes the image preview an attachment opens", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await dropImage(page, "preview.png")

  await page.locator('img[alt="preview.png"]').first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})
