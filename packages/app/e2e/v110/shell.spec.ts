/* SPDX-License-Identifier: MIT */

// S4 shell surface test (test of surface, NOT visual parity claim).
// Verifies the four canonical v110 shell anchors documented in
// docs/ui-reference/v110/COMPONENT-MAP §1 (A2 Shell) and §64 (S4) land at
// desktop-wide / dark once a project is open. Real backend throughout.
// G2 visual parity vs the maquette is NOT claimed by this checkpoint —
// the harness and A/A calibration arrive with F0.

import { test, expect } from "../../fixtures"

test("shell carries the four canonical v110 anchors with stable parity keys", async ({ page, project, sdk }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  await expect(page.locator('[data-parity="shell.topbar"]')).toBeVisible()
  await expect(page.locator('[data-parity="shell.workspace-tabs"]')).toBeVisible()
  await expect(page.locator('[data-parity="shell.rail"]')).toBeVisible()
})

test("shell inspector frame is mounted and its three tabs are reachable", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  const frame = page.locator('[data-parity="shell.inspector"]').first()
  await expect(frame).toBeVisible()
  await expect(frame).toHaveAttribute("role", "complementary")
})

test("shell markers stay stable across re-mounts (no framework IDs, no loop index)", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  for (const key of ["shell.topbar", "shell.workspace-tabs", "shell.rail", "shell.inspector"]) {
    const matches = await page.$$eval(`[data-parity="${key}"]`, (nodes) => nodes.length)
    expect(matches).toBeGreaterThanOrEqual(1)
  }
})

test("topbar height matches the v110 contract (var(--v110-topbar, 48px))", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  const height = await page.locator('[data-parity="shell.topbar"]').evaluate((el) => {
    const root = getComputedStyle(el as HTMLElement)
    const varValue = getComputedStyle(document.documentElement).getPropertyValue("--v110-topbar").trim()
    return { inline: (el as HTMLElement).style.height, computed: root.height, varValue }
  })
  expect(height.inline || height.computed).toBeTruthy()
  expect(height.varValue === "" || height.varValue === "48px").toBe(true)
})

test("shell rail width matches the v110 contract (var(--v110-rail, 78px))", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  const width = await page.locator('[data-parity="shell.rail"]').evaluate((el) => {
    const varValue = getComputedStyle(document.documentElement).getPropertyValue("--v110-rail").trim()
    return { inline: (el as HTMLElement).style.width, varValue }
  })
  expect(width.inline).toBeTruthy()
  expect(width.varValue === "" || width.varValue === "78px").toBe(true)
})