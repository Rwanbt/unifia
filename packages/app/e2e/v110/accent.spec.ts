/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { closeDialog, openSettings } from "../actions"

// ADR-048: the picker in Settings > General > Appearance writes the chosen
// colour onto <html style="--accent: ..."> and mirrors it to accent-color.
// The UI is a combobox (one entry per preset, plus a "Suivre le texte"
// reset), and a separate native colour swatch handles custom values.
// These tests cover the bridge end-to-end: pick a preset through the
// combobox, observe the inline style and the consumers that read
// var(--accent-base); reset through the combobox and observe the inline
// style removed; persist across dialog close/reopen.

async function pickAccentInDialog(dialog: import("@playwright/test").Locator, label: string) {
  const select = dialog.locator('[data-action="settings-accent-select"]')
  await expect(select).toBeVisible()
  await select.locator('[data-slot="select-select-trigger"]').click()
  await expect(
    dialog.locator('[data-slot="select-select-item"]').first(),
  ).toBeVisible()
  await dialog
    .locator('[data-slot="select-select-item"]')
    .filter({ hasText: label })
    .first()
    .click()
}

test("accent combobox writes --accent on <html> and retints consumers", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await pickAccentInDialog(dialog, "Crimson")

  // The createEffect in SettingsProvider writes the inline custom property
  // and the native accent-color mirror.
  const htmlAccent = await page.evaluate(() => {
    const root = document.documentElement
    return {
      custom: root.style.getPropertyValue("--accent"),
      native: root.style.accentColor,
    }
  })
  expect(htmlAccent.custom.toLowerCase()).toBe("#dc2626")
  expect(htmlAccent.native.toLowerCase()).toBe("rgb(220, 38, 38)")

  // A Switch in the ON state under [data-settings-pane] reads
  // var(--accent-base, var(--border-focus)); since --accent-base is now
  // var(--accent), the track must inherit the picked colour.
  const trackColor = await page.evaluate(() => {
    const on = document.querySelector(
      '[data-settings-pane] [role="switch"][data-state="checked"]',
    ) as HTMLElement | null
    if (!on) return null
    return getComputedStyle(on).backgroundColor
  })
  expect(trackColor).not.toBeNull()
  // Allow slight tolerance for color-mix rounding in the strong token.
  expect(["rgb(220, 38, 38)", "rgb(232, 89, 89)"]).toContain(trackColor)

  await closeDialog(page, dialog)
})

test("accent reset (Suivre le texte) removes the inline --accent", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await pickAccentInDialog(dialog, "Sky")
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--accent")),
    )
    .toBe("#0ea5e9")

  await pickAccentInDialog(dialog, "Suivre le texte")

  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--accent")),
    )
    .toBe("")
  const accentColor = await page.evaluate(
    () => document.documentElement.style.accentColor,
  )
  expect(accentColor).toBe("")

  await closeDialog(page, dialog)
})

test("accent combobox persists across dialog close and reopen", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await pickAccentInDialog(dialog, "Emerald")
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--accent")),
    )
    .toBe("#10b981")

  await closeDialog(page, dialog)

  // The dialog must reopen with the same accent still applied: the
  // createEffect in SettingsProvider re-runs on store load from
  // localStorage (settings.v3) and re-writes <html>.
  const reopened = await openSettings(page)
  const stored = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--accent"),
  )
  expect(stored.toLowerCase()).toBe("#10b981")

  await closeDialog(page, reopened)
})

test("accent custom swatch writes the picked hex on <html>", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openSettings(page)

  // Drive the hidden <input type="color"> directly so we can assert the
  // exact value (the native picker is OS-controlled and not openable from
  // headless Chromium).
  const hex = "#7c3aed"
  await page.evaluate((value) => {
    const input = document.querySelector(
      '[data-action="settings-accent-custom"] input[type="color"]',
    ) as HTMLInputElement | null
    if (!input) throw new Error("custom swatch input not found")
    input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, hex)

  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--accent")),
    )
    .toBe(hex)

  // Trigger label should surface "Personnalisé…" for a non-preset value.
  await expect(
    dialog.locator('[data-action="settings-accent-select"] [data-slot="select-select-trigger-value"]'),
  ).toContainText("Personnalisé")

  await closeDialog(page, dialog)
})
