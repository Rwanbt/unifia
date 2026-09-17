/* SPDX-License-Identifier: MIT */

// S7 + S9 + S11 surface test (test of surface, NOT visual parity claim).
// Verifies the v110 work / memory / automate / settings anchors from
// COMPONENT-MAP §4-§6 + §7 + §10 land once a project is open. Real backend.
// G2 visual parity vs the maquette is NOT claimed.

import { test, expect } from "../../fixtures"

test("memory anchor is mounted in the inspector content", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-parity="memory.panel"]').first()).toBeAttached()
})

test("automate surface anchor carries the v110 marker", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${Buffer.from(project.worktree).toString("base64url")}/automate`)
  const surface = page.locator('[data-parity="automate.surface"]').first()
  await expect(surface).toBeVisible()
  await expect(surface).toHaveAttribute("data-v110", "automate-surface")
})

test("work surface anchors expose stable parity keys", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${Buffer.from(project.worktree).toString("base64url")}/work`)
  await expect(page.locator('[data-parity="work.shell"]').first()).toBeVisible()
  await expect(page.locator('[data-parity="work.content"]').first()).toBeVisible()
})

test("settings dialog anchor is mounted when the settings dialog opens", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.keyboard.press("Control+Comma")
  await expect(page.locator('[data-parity="settings.dialog"]').first()).toBeVisible()
})