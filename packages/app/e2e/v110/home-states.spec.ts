/* SPDX-License-Identifier: MIT */

// S3-light home state machine test (test of surface, NOT visual parity
// claim). Verifies the data-state machine wired in S3-light states and
// styled in v110.css. Real backend. G2 visual parity vs the maquette is
// NOT claimed by this checkpoint -- only the state attribute contract
// is wired.

import { test, expect } from "../../fixtures"

test("home root carries a data-state attribute", async ({ page }) => {
  await page.goto("/")
  const home = page.locator('[data-v110="home"]').first()
  await expect(home).toBeAttached()
  const state = await home.getAttribute("data-state")
  expect(state).toMatch(/^(loading|empty|ready)$/)
})

test("home title and modes row stay mounted across every data-state", async ({ page }) => {
  await page.goto("/")
  for (const state of ["loading", "empty", "ready"] as const) {
    await page.evaluate((s) => {
      const root = document.querySelector('[data-v110="home"]') as HTMLElement | null
      if (root) root.setAttribute("data-state", s)
    }, state)
    await expect(page.locator('[data-parity="home.title"]').first()).toBeAttached()
    await expect(page.locator('[data-parity="home.modes-row"]').first()).toBeAttached()
    await expect(page.locator('[data-parity="home.mode-pill"]')).toHaveCount(6)
  }
})

test("home-empty anchor matches the data-state=empty chrome", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => {
    const root = document.querySelector('[data-v110="home"]') as HTMLElement | null
    if (root) root.setAttribute("data-state", "empty")
  })
  const empty = page.locator('[data-v110="home-empty"]').first()
  await expect(empty).toBeAttached()
  await expect(empty).toHaveAttribute("data-state", "empty")
})

test("home-loading anchor renders when data-state=loading", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => {
    const root = document.querySelector('[data-v110="home"]') as HTMLElement | null
    if (root) root.setAttribute("data-state", "loading")
  })
  const loading = page.locator('[data-v110="home-loading"]').first()
  await expect(loading).toBeAttached()
  await expect(loading).toHaveAttribute("data-state", "loading")
})