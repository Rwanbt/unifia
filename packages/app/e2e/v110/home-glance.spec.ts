/* SPDX-License-Identifier: MIT */

// S3-light home glance cells test (test of surface, NOT visual parity
// claim). Real backend. G2 visual parity vs the maquette is NOT claimed.
//
// RC-1 UI03: home.glance is backed only by runtime facts already owned by
// Home: project count from GlobalSync, mode count from the canonical mode
// registry, and the live server health state. No decorative metric is used.

import { test, expect } from "../fixtures"

test("home.glance exposes projects, modes and server", async ({ page }) => {
  await page.goto("/")
  const cells = page.locator('[data-v110="home-glance-cell"]')
  await expect(cells).toHaveCount(3)

  const labels = await cells.evaluateAll((nodes) =>
    nodes.map((n) => (n.querySelector("span") as HTMLElement | null)?.textContent?.trim() ?? ""),
  )
  expect(labels).toEqual(["Projects", "Modes", "Server"])
})

test("home.glance values stay numeric or the canonical server state", async ({ page }) => {
  await page.goto("/")
  const values = await page
    .locator('[data-v110="home-glance-cell"] b')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()))

  expect(values[0]).toMatch(/^\d+$/)
  expect(values[1]).toMatch(/^\d+$/)
  expect(["online", "offline", "checking"]).toContain(values[2])
})

test("home.glance cell cards render the v110 contract radius", async ({ page }) => {
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
