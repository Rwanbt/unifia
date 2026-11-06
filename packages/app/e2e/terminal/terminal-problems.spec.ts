/* SPDX-License-Identifier: MIT */

// #680: the terminal panel's Problems tab is a real view now. It lists the LSP
// diagnostics store; the e2e backend runs no language server, so the deterministic
// state here is the empty list, and the PTY must survive the round trip.
import { prepareTerminal, waitTerminalReady } from "../actions"
import { test, expect } from "../fixtures"
import { terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"

test("Problems tab swaps the terminal for the diagnostics list and back", async ({ page, gotoSession }) => {
  await gotoSession()
  const terminal = page.locator(terminalSelector)
  await prepareTerminal(page)
  if (!(await terminal.isVisible().catch(() => false))) await page.keyboard.press(terminalToggleKey)
  await waitTerminalReady(page, { term: terminal })

  const problemsTab = page.locator('[data-terminal-view="problems"]')
  await expect(problemsTab).not.toHaveAttribute("aria-disabled", "true")
  await problemsTab.click()
  await expect(problemsTab).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-v110="terminal-problems"]')).toBeVisible()
  await expect(page.locator('[data-v110="terminal-problems-empty"]')).toBeVisible()
  await expect(page.locator('[data-v110="terminal-body"]')).toBeHidden()

  await page.locator('[data-terminal-view="terminal"]').click()
  await expect(page.locator('[data-v110="terminal-problems"]')).toHaveCount(0)
  await expect(terminal).toBeVisible()
})
