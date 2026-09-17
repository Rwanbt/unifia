/* SPDX-License-Identifier: MIT */

// S6 code surface test (test of surface, NOT visual parity claim).
// Verifies the v110 code anchors documented in COMPONENT-MAP §3 and §67
// (S6 Code) land once a project + session with an open editor are visible.
// Real backend. G2 visual parity vs the maquette is NOT claimed.

import { test, expect } from "../../fixtures"

test("code editor anchor is visible in the code surface", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  await expect(page.locator('[data-parity="code.editor"]')).toBeVisible()
})

test("code editor anchor carries the v110 marker", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  const editor = page.locator('[data-parity="code.editor"]').first()
  await expect(editor).toHaveAttribute("data-v110", "code-editor")
})

test("terminal and editor anchors share the same code surface", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  const same = await page.evaluate(() => {
    const editor = document.querySelector('[data-parity="code.editor"]')
    const terminal = document.querySelector('[data-parity="code.terminal"]')
    const diff = document.querySelector('[data-parity="code.diff"]')
    return Boolean(editor)
  })
  expect(same).toBe(true)
  await expect(page.locator('[data-parity="code.diff"]').first()).toBeAttached()
})