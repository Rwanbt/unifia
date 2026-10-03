import { test, expect } from "../fixtures"
import { defocus, prepareTerminal, waitTerminalFocusIdle, waitTerminalReady } from "../actions"
import { terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"

test("smoke terminal mounts and can create a second tab", async ({ page, gotoSession }) => {
  await gotoSession()

  const terminals = page.locator(terminalSelector)
  const tabs = page.locator('#terminal-panel [data-slot="tabs-trigger"]')
  await prepareTerminal(page)
  const opened = await terminals.first().isVisible()

  if (!opened) {
    await page.keyboard.press(terminalToggleKey)
  }

  await waitTerminalFocusIdle(page, { term: terminals.first() })
  await expect(terminals).toHaveCount(1)

  // Ghostty captures a lot of keybinds when focused; move focus back
  // to the app shell before triggering `terminal.new`. Clicking the composer used
  // to do that, but the composer is not rendered in the Editor layout this test
  // now needs for the terminal, so blur the focused element directly instead.
  await defocus(page)
  await page.keyboard.press("Control+Alt+T")

  await expect(tabs).toHaveCount(2)
  // One `[data-component="terminal"]` per PTY, so a second tab means a second
  // element in the DOM. The count of 1 only held while there was one tab.
  await expect(terminals).toHaveCount(2)
  await waitTerminalReady(page, { term: terminals.first() })
})
