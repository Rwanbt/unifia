/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { closeDialog, openSettings } from "../actions"

// ADR-048: the accent combobox in Settings > General > Appearance writes the
// chosen colour onto <html style="--accent: ..."> and mirrors it to
// accent-color. Presets are addressed by their stable data-accent id, not by
// their translated label.

type Dialog = import("@playwright/test").Locator

async function pickAccent(dialog: Dialog, id: string) {
  await dialog.locator('[data-action="settings-accent-select"]').click()
  await dialog.locator(`[data-slot="accent-option"][data-accent="${id}"]`).click()
}

const inlineAccent = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))

test("a preset writes --accent on <html> and retints a Switch that is on", async ({ page, gotoSession }) => {
  await gotoSession()
  const dialog = await openSettings(page)

  await pickAccent(dialog, "red")
  await expect.poll(() => inlineAccent(page)).toBe("#d96868")
  expect(await page.evaluate(() => document.documentElement.style.accentColor)).toBe("rgb(217, 104, 104)")

  // The track animates its colour, so wait for the transition to settle.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const on = document.querySelector('[data-component="switch"][data-checked] [data-slot="switch-control"]')
        return on ? getComputedStyle(on).backgroundColor : null
      }),
    )
    .toBe("rgb(217, 104, 104)")

  await closeDialog(page, dialog)
})

test("Neutral removes the inline --accent", async ({ page, gotoSession }) => {
  await gotoSession()
  const dialog = await openSettings(page)

  await pickAccent(dialog, "cyan")
  await expect.poll(() => inlineAccent(page)).toBe("#37b9d5")
  await pickAccent(dialog, "neutral")
  await expect.poll(() => inlineAccent(page)).toBe("")
  expect(await page.evaluate(() => document.documentElement.style.accentColor)).toBe("")

  await closeDialog(page, dialog)
})

test("the chosen accent survives closing and reopening settings", async ({ page, gotoSession }) => {
  await gotoSession()
  const dialog = await openSettings(page)
  await pickAccent(dialog, "green")
  await expect.poll(() => inlineAccent(page)).toBe("#48b881")
  await closeDialog(page, dialog)

  const reopened = await openSettings(page)
  expect(await inlineAccent(page)).toBe("#48b881")
  await expect(reopened.locator('[data-slot="accent-option"][data-accent="green"]')).toHaveCount(0)
  await reopened.locator('[data-action="settings-accent-select"]').click()
  await expect(reopened.locator('[data-slot="accent-option"][data-accent="green"]')).toHaveAttribute("aria-selected", "true")
  await closeDialog(page, reopened)
})

test("the custom colour row writes the picked hex", async ({ page, gotoSession }) => {
  await gotoSession()
  const dialog = await openSettings(page)
  await dialog.locator('[data-action="settings-accent-select"]').click()

  // The native picker is OS-controlled, so drive the input directly.
  const hex = "#7c3aed"
  await dialog.locator('[data-slot="accent-color"]').evaluate((input, value) => {
    ;(input as HTMLInputElement).value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, hex)

  await expect.poll(() => inlineAccent(page)).toBe(hex)
  await closeDialog(page, dialog)
})
