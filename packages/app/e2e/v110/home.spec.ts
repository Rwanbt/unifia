/* SPDX-License-Identifier: MIT */

// V0 pilot visual surface test (test of surface, NOT visual parity claim).
// Verifies the three canonical anchors documented in COMPONENT-MAP §1 land on
// the home route at desktop-wide / dark, with the six stable semantic keys
// (code, work, design, automate, browser, memory) — G2 visual parity remains
// to be qualified in the image with reference/app isolated contexts.

import { test, expect } from "../fixtures"

const PILLS = ["code", "work", "design", "automate", "browser", "memory"] as const

test("home renders the three pilot anchors and the six semantic pills", async ({ page, sdk }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.waitForLoadState("networkidle")

  await expect(page.locator('[data-parity="home.title"]')).toBeVisible()
  await expect(page.locator('[data-parity="home.modes-row"]')).toBeVisible()

  for (const pill of PILLS) {
    const locator = page.locator(`[data-parity="home.mode-pill"][data-home-open-mode="${pill}"]`)
    await expect(locator).toBeVisible()
    await expect(locator).toHaveText(new RegExp(`^${pill}$`, "i"))
  }
})

test("home mode pills keep their stable semantic keys (no framework IDs, no loop index)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.waitForLoadState("networkidle")

  const keys = await page.$$eval(
    '[data-parity="home.mode-pill"]',
    (nodes) => nodes.map((n) => n.getAttribute("data-home-open-mode")),
  )

  expect(keys).toHaveLength(6)
  expect([...keys].sort()).toEqual([...PILLS].sort())

  const unique = new Set(keys)
  expect(unique.size).toBe(6)
})

test("home mode pill design receives focus-visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.waitForLoadState("networkidle")

  const pill = page.locator('[data-parity="home.mode-pill"][data-home-open-mode="design"]')
  await pill.focus()
  await expect(pill).toBeFocused()

  const focusVisible = await pill.evaluate((node) => node.matches(":focus-visible"))
  expect(focusVisible).toBe(true)
})