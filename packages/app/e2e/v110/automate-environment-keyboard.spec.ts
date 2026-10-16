/* SPDX-License-Identifier: MIT */

// #553 criterion 5 — the Automate studio's Environment drawer, driven from the
// keyboard.
//
// INTERACTIONS.md (Overlays) already writes the contract: "command palette,
// compute popover, work-capture, quick-account menu, modals avec focus-trap et
// retour focus". The drawer is the studio's only overlay — a full-bleed scrim
// (v110-automate.css "Environment drawer", inset: 0) with a reading panel on the
// right that a click outside dismisses — and it carried none of that contract:
// no dialog role, focus left on the opener behind the scrim (so the panel's own
// Close button was unreachable without tabbing through the whole studio first),
// no Tab confinement, and closing dropped focus to <body> instead of returning
// it to the opener.
//
// The layout is the studio's own: pages/workbench/automate-surface.tsx mounts
// the drawer, automate-studio-header.tsx owns the "Environment" button. The
// workbench mock serves a real definition so the studio opens a workflow by
// itself, as automate-responsive.spec.ts does.

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

const DEFINITION_PATH = ".unifia/workflows/e2e-environment-flow.json"
const DEFINITION = {
  id: "e2e-environment-flow",
  version: 1,
  steps: [
    { id: "fetch", family: "io.http" },
    { id: "approve", family: "human.approval", requiresApproval: true },
  ],
}

const OVERLAY = "[data-automate-studio-environment-overlay]"
const PANEL = "[data-automate-studio-environment-panel]"
const OPENER = "[data-automate-studio-env]"

test.describe("Automate studio — Environment drawer keyboard contract", () => {
  test.beforeEach(async ({ page, directory, gotoSession }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installWorkbenchMock(page, {
      workspaceId: "mock-workspace-1",
      grants: ["workflow.run"],
      files: [{ path: DEFINITION_PATH, kind: "file" }],
      fileContents: { [DEFINITION_PATH]: JSON.stringify(DEFINITION) },
    })
    await gotoSession()
    await page.goto(`${dirPath(directory)}/automate`)
    await expect(page.locator('[data-workbench-surface="automate"]')).toBeVisible()
  })

  test("the drawer opens as a named dialog and keeps Tab inside its panel", async ({ page }) => {
    // Reach the opener the way a keyboard user does, then activate it.
    const opener = page.locator(OPENER)
    await opener.focus()
    await expect(opener).toBeFocused()
    await page.keyboard.press("Enter")

    const overlay = page.locator(OVERLAY)
    const panel = page.locator(PANEL)
    await expect(overlay).toBeVisible()
    await expect(panel).toBeVisible()

    // The modal contract: a dialog, announced as modal, with a name.
    await expect(panel).toHaveAttribute("role", "dialog")
    await expect(panel).toHaveAttribute("aria-modal", "true")
    const labelledby = await panel.getAttribute("aria-labelledby")
    expect(labelledby, "the drawer must be named by its own title").toBeTruthy()
    await expect(page.locator(`#${labelledby}`)).toHaveText(/\S/)

    // Where focus is, in terms of the drawer: [inside] or [outside].
    const active = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return "none"
        return el.closest("[data-automate-studio-environment-panel]") ? "[inside]" : "[outside]"
      })
    const inside = async () => (await active()) === "[inside]"

    // Focus must move into the panel: a keyboard user who opened the drawer has
    // to be able to read it and dismiss it without walking the studio behind it.
    await expect.poll(inside, { message: "focus enters the drawer on open" }).toBe(true)

    // Tab must not escape the drawer while it is open. Twelve presses is more
    // than the panel holds, so a leak shows up as [outside] well before the end.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab")
      expect(await active(), `Tab ${step + 1} must stay inside the drawer`).toBe("[inside]")
    }
    // And backwards, which is the direction a naive "focus the first control"
    // trap misses.
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Shift+Tab")
      expect(await active(), `Shift+Tab ${step + 1} must stay inside the drawer`).toBe("[inside]")
    }
  })

  test("Escape and the Close button both return focus to the opener", async ({ page }) => {
    const opener = page.locator(OPENER)
    const overlay = page.locator(OVERLAY)

    const openFromKeyboard = async () => {
      await opener.focus()
      await page.keyboard.press("Enter")
      await expect(overlay).toBeVisible()
    }

    // Escape.
    await openFromKeyboard()
    await page.keyboard.press("Escape")
    await expect(overlay).toHaveCount(0)
    await expect(opener, "Escape must hand focus back to the opener").toBeFocused()

    // The panel's own Close button, reached from the keyboard.
    await openFromKeyboard()
    const close = page.locator("[data-automate-studio-environment-close]")
    await close.focus()
    await page.keyboard.press("Enter")
    await expect(overlay).toHaveCount(0)
    await expect(opener, "Close must hand focus back to the opener").toBeFocused()
  })
})
