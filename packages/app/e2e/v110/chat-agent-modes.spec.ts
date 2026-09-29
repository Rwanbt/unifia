/* SPDX-License-Identifier: MIT */

// Phase 4 remainder: the composer's agent control carries the v16 mode
// glyphs (maquette module `unifia-v16-agent-modes`) and switching modes
// swaps the real runtime controls - the debate/team model selectors replace
// the standard model control. Every mode asserted here is a primary agent
// the runtime actually registers (build/chat/plan/debate/team/auto); there
// is no fabricated Auto tab.

import { test, expect, type Page } from "../fixtures"

async function pickAgent(page: Page, name: string): Promise<void> {
  await page.locator('[data-component="prompt-agent-control"]').getByRole("button").first().click()
  await page.getByRole("option", { name, exact: true }).click()
}

test("agent modes show the v16 glyphs and swap the real model controls", async ({ page, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoSession()

  const control = page.locator('[data-component="prompt-agent-control"]')
  const icon = control.locator('[data-component="agent-mode-icon"]')
  await expect(icon).toBeVisible()

  await pickAgent(page, "plan")
  await expect(icon).toHaveAttribute("data-mode", "plan")
  await expect(page.locator('[data-component="prompt-model-control"]')).toBeVisible()

  await pickAgent(page, "debate")
  await expect(icon).toHaveAttribute("data-mode", "debate")
  await expect(page.locator('[data-component="prompt-debate-model-control"]')).toBeVisible()
  await expect(page.locator('[data-component="prompt-model-control"]')).not.toBeVisible()

  await pickAgent(page, "team")
  await expect(icon).toHaveAttribute("data-mode", "team")
  await expect(page.locator('[data-component="prompt-team-model-control"]')).toBeVisible()

  await pickAgent(page, "auto")
  await expect(icon).toHaveAttribute("data-mode", "auto")
  await expect(page.locator('[data-component="prompt-model-control"]')).toBeVisible()
})