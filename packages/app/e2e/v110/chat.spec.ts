/* SPDX-License-Identifier: MIT */

// S5 chat / composer surface test (test of surface, NOT visual parity claim).
// Verifies the v110 chat anchors documented in COMPONENT-MAP §2 and §66
// (S5 Session/Chat) land once a project + session are open. Real backend.
// G2 visual parity vs the maquette is NOT claimed by this checkpoint.

import { test, expect } from "../../fixtures"

test("chat carries the v110 chat anchor", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  await expect(page.locator('[data-parity="session.chat"]')).toBeVisible()
  await expect(page.locator('[data-parity="session.chat"]')).toHaveAttribute("role", "log")
})

test("composer dock anchor is mounted when the session view opens", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  await expect(page.locator('[data-parity="session.composer"]')).toBeVisible()
})

test("chat and composer are siblings of the shell frame (stable anchoring)", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  const inside = await page.evaluate(() => {
    const topbar = document.querySelector('[data-parity="shell.topbar"]')
    const chat = document.querySelector('[data-parity="session.chat"]')
    const composer = document.querySelector('[data-parity="session.composer"]')
    if (!topbar || !chat || !composer) return false
    const top = topbar.getBoundingClientRect().bottom
    const chatTop = chat.getBoundingClientRect().top
    const composerTop = composer.getBoundingClientRect().top
    return composerTop >= chatTop && chatTop >= top
  })
  expect(inside).toBe(true)
})