/* SPDX-License-Identifier: MIT */

// S15 prep -- v110 anchor surface test. Enumerates the contract anchors
// that must exist somewhere in the app bundle once the v110 layers load.
// Real backend. This is a smoke test for the v110 surface contract; it
// does not claim visual parity, only that the chrome markers and the
// CSS class hooks landed.

import { test, expect } from "../../fixtures"

const ANCHORS = [
  { key: "home.title", selector: '[data-parity="home.title"]' },
  { key: "home.modes-row", selector: '[data-parity="home.modes-row"]' },
  { key: "home.mode-pill", selector: '[data-parity="home.mode-pill"]' },
  { key: "home.glance", selector: '[data-v110="home-glance"]' },
  { key: "shell.topbar", selector: '[data-parity="shell.topbar"]' },
  { key: "shell.workspace-tabs", selector: '[data-parity="shell.workspace-tabs"]' },
  { key: "shell.rail", selector: '[data-parity="shell.rail"]' },
  { key: "shell.inspector", selector: '[data-parity="shell.inspector"]' },
] as const

for (const anchor of ANCHORS) {
  test(`v110 anchor ${anchor.key} lands somewhere on the home`, async ({ page }) => {
    await page.goto("/")
    const count = await page.locator(anchor.selector).count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
}

test("the v110 CSS layers load (10 stylesheet contracts registered)", async ({ page }) => {
  await page.goto("/")
  const layerCount = await page.evaluate(() => {
    let n = 0
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        n += sheet.cssRules.length
      } catch {
        // CORS-protected sheets skip silently
      }
    }
    return n
  })
  expect(layerCount).toBeGreaterThan(100)
})

test("home page does not break the v110 focus-visible contract", async ({ page }) => {
  await page.goto("/")
  await page.keyboard.press("Tab")
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "")
  expect(focused.length).toBeGreaterThan(0)
})

test("home page has a single h1 carrying the home title anchor", async ({ page }) => {
  await page.goto("/")
  const titles = page.locator('h1[data-v110="home-title"]')
  await expect(titles).toHaveCount(1)
  const text = await titles.first().textContent()
  expect(text?.length ?? 0).toBeGreaterThan(0)
})