/* SPDX-License-Identifier: MIT */

// #553 criterion 5 — the Settings rail's ARIA structure and keyboard contract.
//
// Measured with axe (WCAG 2.1 A/AA tags) on the settings dialog's default
// state, on pristine origin/dev:
//
//   * aria-required-children (critical) on div[data-slot="tabs-list"]:
//     "Element has children which are not allowed: nav". The rail wrapped its
//     tabs in a <nav> landmark inside role="tablist", and a tab list may only
//     own tabs.
//
//   * aria-required-parent (critical, 17 nodes) on every tab: a tab's closest
//     role-bearing ancestor was that <nav> (implicit role="navigation"), not the
//     tab list, so all seventeen triggers lost their required parent.
//
// One wrapper causes both, which is why they are one tranche.
//
// The same spec certifies the criterion on this surface: the rail is reachable
// with Tab alone, and it answers the arrow keys with roving selection — the
// keyboard pattern the tab role promises and the only way to change page
// without a pointer.

import { test, expect } from "../fixtures"
import { openSettings } from "../actions"
import { expectNoNewViolations } from "../design/axe"

const RAIL = '[data-slot="tabs-list"]'

test.describe("Settings — the rail's ARIA structure and keyboard", () => {
  test.beforeEach(async ({ page, gotoSession }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSession()
    await openSettings(page)
    await expect(page.locator(RAIL)).toBeVisible()
  })

  test("the rail's tab list owns its tabs", async ({ page }) => {
    const rail = page.locator(RAIL)
    await expect(rail).toHaveAttribute("role", "tablist")

    const tabs = rail.getByRole("tab")
    expect(await tabs.count(), "the rail lists its pages as tabs").toBeGreaterThan(1)

    // A tab's required parent is the tab list, and nothing role-bearing may sit
    // between the two: a landmark there is at once an illegal child of the tab
    // list (aria-required-children) and the reason every tab loses its parent
    // (aria-required-parent). The tag list names the landmark elements; axe
    // remains the general authority in the last test of this file.
    const between = await tabs.first().evaluate((node) => {
      const list = node.closest('[role="tablist"]')
      const landmarks = ["NAV", "MAIN", "ASIDE", "HEADER", "FOOTER", "FORM", "SEARCH"]
      const offenders: string[] = []
      for (let cur = node.parentElement; cur && cur !== list; cur = cur.parentElement) {
        const role = cur.getAttribute("role")
        if (role || landmarks.includes(cur.tagName)) offenders.push(`${cur.tagName}${role ? `[role=${role}]` : ""}`)
      }
      return offenders
    })
    expect(between, "role-bearing elements between a tab and the tab list").toEqual([])
  })

  test("the rail is reachable and driven from the keyboard", async ({ page }) => {
    // Reachability, bounded: the settings surface does not move focus into
    // itself on open (measured: focus stays on the body), so the rail has to be
    // reachable from wherever focus was. A broken focus order fails here instead
    // of hanging.
    let reached = false
    for (let press = 0; press < 30 && !reached; press++) {
      await page.keyboard.press("Tab")
      reached = await page.evaluate(() => !!document.activeElement?.closest('[data-slot="tabs-list"]'))
    }
    expect(reached, "the rail is reachable with Tab alone").toBe(true)

    const general = page.getByRole("tab", { name: "General", exact: true })
    const audio = page.getByRole("tab", { name: "Audio", exact: true })
    await expect(general).toBeFocused()
    await expect(general).toHaveAttribute("aria-selected", "true")

    // Roving selection: the arrow keys move both focus and selection, the
    // pattern the tab role promises. The rail is vertical, so up/down.
    await page.keyboard.press("ArrowDown")
    await expect(audio).toBeFocused()
    await expect(audio).toHaveAttribute("aria-selected", "true")

    await page.keyboard.press("ArrowUp")
    await expect(general).toBeFocused()
    await expect(general).toHaveAttribute("aria-selected", "true")
  })

  test("the rail has no new axe violations", async ({ page }, testInfo) => {
    // Scoped to the rail on purpose. A dialog-level scan of this surface also
    // reports the General page's six unlabelled switches (axe `label`, critical),
    // which are their own tranche: they need a labelling decision on
    // SettingsRow/Switch, not this one.
    await expectNoNewViolations(page, testInfo, "Settings rail", RAIL)
  })
})
