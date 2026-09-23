/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { closeDialog, openSettings } from "../actions"

// ADR-048: the picker in Settings > General > Appearance writes the chosen
// colour onto <html style="--accent: ..."> and mirrors it to accent-color.
// These tests cover the bridge end-to-end: pick a preset, observe the
// inline style and the consumers that read var(--accent-base); reset and
// observe the inline style removed.

test("accent picker writes --accent on <html> and retints consumers", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openSettings(page)

  // The General tab is the default; the picker lives under Appearance.
  const crimson = dialog.locator('[data-action="settings-accent-preset-crimson"]')
  await expect(crimson).toBeVisible()
  await crimson.click()

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
  // var(--accent-base, var(--border-focus)); since we tied --accent-base
  // to var(--accent), the track must inherit the picked colour.
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

test("accent reset removes the inline --accent from <html>", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openSettings(page)

  const sky = dialog.locator('[data-action="settings-accent-preset-sky"]')
  await sky.click()
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--accent")),
    )
    .toBe("#0ea5e9")

  const reset = dialog.locator('[data-action="settings-accent-reset"]')
  await reset.click()

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

test("accent picker persists across dialog close and reopen", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await dialog.locator('[data-action="settings-accent-preset-emerald"]').click()
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
