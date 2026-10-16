/* SPDX-License-Identifier: MIT */

// #553 criterion 5 — keyboard navigation, focus order and Escape, certified on
// the Design surface's approval modal.
//
// INTERACTIONS.md names the overlay contract verbatim: "modals avec focus-trap
// et retour focus". The modal declared `aria-modal="true"`, but it moved no
// focus into itself, let Tab walk out into the surface behind it, and ignored
// Escape: the pointer was the only way out. The axe gate next door cannot see
// any of that — axe reads attributes, not focus movement — which is exactly
// why this file drives a real browser.
//
// Escape has to mean the visible cancel action: the machine treats
// `kind === "approval-required"` as cancellable and every other state as a
// no-op, so the assertion is on the broker call the modal actually makes.

import { test, expect } from "../fixtures"
import { openDesignSurface, submitExport } from "./surface"
import { readMockCalls } from "../fixtures/workbench-mock"

const MODAL = "[data-design-approval-modal]"
const EXPORT = "[data-design-export-render]"
const DENY = '[data-design-approval-action="deny"]'
const ALLOW = '[data-design-approval-action="allow"]'

test.describe("Design approval modal — keyboard", () => {
  test("opens with focus inside and Escape cancels, returning focus to the export button", async ({
    page,
    directory,
  }) => {
    await openDesignSurface(page, directory, { exportOutcome: "approval-required" })
    await submitExport(page)

    const modal = page.locator(MODAL)
    await expect(modal).toBeVisible()
    // The modal is modal: focus belongs to it, not to the button behind it.
    await expect(modal).toBeFocused()

    await page.keyboard.press("Escape")
    await expect(modal).toHaveCount(0)
    // Escape ran the cancel the user can see, not some other dismissal.
    await expect
      .poll(async () => (await readMockCalls(page)).filter((call) => call.method === "cancelApproval").length)
      .toBe(1)
    // And the keyboard comes back where it left.
    await expect(page.locator(EXPORT)).toBeFocused()
  })

  test("keeps Tab inside the modal, wrapping at both ends", async ({ page, directory }) => {
    await openDesignSurface(page, directory, { exportOutcome: "approval-required" })
    await submitExport(page)
    await expect(page.locator(MODAL)).toBeVisible()

    await page.locator(DENY).focus()
    await expect(page.locator(DENY)).toBeFocused()
    // Shift+Tab from the first control wraps to the last.
    await page.keyboard.press("Shift+Tab")
    await expect(page.locator(ALLOW)).toBeFocused()
    // Tab from the last control wraps back to the first.
    await page.keyboard.press("Tab")
    await expect(page.locator(DENY)).toBeFocused()
  })
})
