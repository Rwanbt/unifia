import { test, expect } from "../fixtures"
import { prepareTerminal, waitTerminalReady } from "../actions"
import { terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"

test("terminal panel can be toggled", async ({ page, gotoSession }) => {
  await gotoSession()
  await prepareTerminal(page)

  const terminal = page.locator(terminalSelector)
  const initiallyOpen = await terminal.isVisible()
  if (initiallyOpen) {
    await page.keyboard.press(terminalToggleKey)
    await expect(terminal).toHaveCount(0)
  }

  await page.keyboard.press(terminalToggleKey)
  await waitTerminalReady(page, { term: terminal })
})
