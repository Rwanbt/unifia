/* SPDX-License-Identifier: MIT */

// S3-light home glance cells test (test of surface, NOT visual parity
// claim). Real backend. G2 visual parity vs the maquette is NOT claimed.
//
// The three `home.glance` cells this file was written for were never added to
// `home.tsx`: the markers `data-v110="home-glance"` and
// `data-v110="home-glance-cell"` appear nowhere in `packages/app/src`, and there is
// no `home.glance` entry in `e2e/v110/parity-manifest/`. `anchors.spec.ts:15`
// lists the anchor but asserts `toBeGreaterThanOrEqual(0)`, which cannot fail, so
// nothing caught the gap. That makes it a declared-but-unwired capability
// (RB05/RB07), not a stale selector, so the cell assertions are quarantined below
// with their reason rather than deleted or rewritten against current output.
//
// The last test is unrelated to glance and always measured real page overflow; it
// is renamed to say so.

import { test, expect } from "../fixtures"

test.fixme("home.glance cells are declared in the spec but absent from home.tsx", async ({ page }) => {
  await page.goto("/")
  const cells = page.locator('[data-v110="home-glance-cell"]')
  await expect(cells).toHaveCount(3)

  const labels = await cells.evaluateAll((nodes) =>
    nodes.map((n) => (n.querySelector("span") as HTMLElement | null)?.textContent?.trim() ?? ""),
  )
  expect(labels).toEqual(["Projects", "Modes", "Server"])
})

test.fixme("home.glance values stay numeric or the canonical server state", async ({ page }) => {
  await page.goto("/")
  const values = await page
    .locator('[data-v110="home-glance-cell"] b')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()))

  expect(values[0]).toMatch(/^\d+$/)
  expect(values[1]).toMatch(/^\d+$/)
  expect(["online", "offline", "checking"]).toContain(values[2])
})

test.fixme("home.glance cell cards render the v110 contract radius", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  const radius = await page
    .locator('[data-v110="home-glance-cell"]')
    .first()
    .evaluate((el) => getComputedStyle(el as HTMLElement).borderRadius)
  expect(radius).toMatch(/^\d+px$/)
})

test("the home surface does not overflow horizontally at any viewport", async ({ page }) => {
  for (const width of [1440, 1100, 800, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      return Math.max(0, root.scrollWidth - root.clientWidth)
    })
    expect(overflow, `${width}px: home x-overflow ${overflow}px exceeds 12px`).toBeLessThanOrEqual(12)
  }
})
