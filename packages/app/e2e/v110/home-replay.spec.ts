/* SPDX-License-Identifier: MIT */

// S3 Home re-play -- extends the home-states.spec.ts to the full matrix
// documented in §11 (S3 Home) of the consolidated plan. Replays Home at
// the 5 viewports × 3 themes × 4 states documented in
// docs/ui-reference/v110/RESPONSIVE-MATRIX.md. G2 visual parity vs the
// maquette is NOT claimed by this checkpoint -- only the structural
// markers stay mounted. Pixel proof waits for the harness shipped in F0.

import { test, expect } from "../../fixtures"

const VIEWPORTS = [
  { id: "desktop-wide", width: 1440, height: 900 },
  { id: "desktop-compact", width: 1100, height: 800 },
  { id: "tablet-portrait", width: 800, height: 1100 },
  { id: "phone-portrait", width: 390, height: 844 },
  { id: "compact-landscape", width: 900, height: 480 },
] as const

const STATES = ["loading", "empty", "ready"] as const

const THEMES = ["dark", "light"] as const

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    for (const state of STATES) {
      test(`home re-plays at ${viewport.id} / ${theme} / ${state}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme })
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto("/")
        await page.evaluate((s) => {
          const root = document.querySelector('[data-v110="home"]') as HTMLElement | null
          if (root) root.setAttribute("data-state", s)
        }, state)

        await expect(page.locator('[data-parity="home.title"]')).toBeAttached()
        await expect(page.locator('[data-parity="home.modes-row"]')).toBeAttached()
        await expect(page.locator('[data-parity="home.mode-pill"]')).toHaveCount(6)

        const overflow = await page.evaluate(() => {
          const root = document.documentElement
          return Math.max(0, root.scrollWidth - root.clientWidth)
        })
        expect(overflow).toBeLessThanOrEqual(12)
      })
    }
  }
}

test("home mode pill text content stays stable across the matrix", async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto("/")

    const labels = await page
      .locator('[data-parity="home.mode-pill"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLElement).getAttribute("data-home-open-mode") ?? ""),
      )
    expect(labels.sort()).toEqual(["automate", "browser", "code", "design", "memory", "work"])
  }
})

test("home titles use the v110 typography token at desktop-wide", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")

  const fontSize = await page.locator('[data-parity="home.title"]').evaluate((el) => {
    return getComputedStyle(el as HTMLElement).fontSize
  })
  expect(fontSize).toBe("30px")
})

test("home titles collapse to mobile font-size at phone-portrait", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")

  const fontSize = await page.locator('[data-parity="home.title"]').evaluate((el) => {
    return getComputedStyle(el as HTMLElement).fontSize
  })
  expect(fontSize).toBe("24px")
})