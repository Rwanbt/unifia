/* SPDX-License-Identifier: MIT */

// S13 responsive surface test (test of surface, NOT visual parity claim).
// Verifies the v110 responsive matrix documented in
// docs/ui-reference/v110/RESPONSIVE-MATRIX.md and tokens/viewport.ts
// classifies the five canonical profiles from a real layout shell. Real
// backend. G2 visual parity vs the maquette is NOT claimed by this
// checkpoint — pixel-level proof waits for the harness shipped in F0.

import { test, expect } from "../../fixtures"

const VIEWPORTS = [
  { id: "desktop-wide", width: 1440, height: 900 },
  { id: "desktop-compact", width: 1100, height: 800 },
  { id: "tablet-portrait", width: 800, height: 1100 },
  { id: "phone-portrait", width: 390, height: 844 },
  { id: "compact-landscape", width: 900, height: 480 },
] as const

test("shell anchors stay mounted across the responsive matrix", async ({ page, project }) => {
  await project.open()
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await expect(page.locator('[data-parity="shell.topbar"]')).toBeVisible()
    await expect(page.locator('[data-parity="shell.workspace-tabs"]')).toBeVisible()
  }
})

test("home anchors stay mounted across the responsive matrix", async ({ page }) => {
  await page.goto("/")
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await expect(page.locator('[data-parity="home.title"]')).toBeVisible()
    await expect(page.locator('[data-parity="home.modes-row"]')).toBeVisible()
    const pills = page.locator('[data-parity="home.mode-pill"]')
    await expect(pills).toHaveCount(6)
  }
})

test("shell topbar height stays under the v110 contract at every viewport", async ({ page, project }) => {
  await project.open()
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const height = await page.locator('[data-parity="shell.topbar"]').evaluate((el) => {
      return (el as HTMLElement).getBoundingClientRect().height
    })
    expect(height).toBeGreaterThan(0)
    expect(height).toBeLessThanOrEqual(72)
  }
})

test("home modes row reflows without horizontal overflow", async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto("/")
    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      return Math.max(0, root.scrollWidth - root.clientWidth)
    })
    expect(overflow).toBeLessThanOrEqual(8)
  }
})