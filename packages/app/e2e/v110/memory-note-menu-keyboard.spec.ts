/* SPDX-License-Identifier: MIT */

// #553 criterion 5 (keyboard navigation / focus order / escape behaviour),
// Memory surface.
//
// The vault note menu is declared `role="menu"` next to a keyboard-reachable
// opener (`[data-memory-more]` in the note toolbar). A `role="menu"` is a
// contract with the user agent: focus enters the menu when it opens, arrow
// keys walk its items, and Escape closes it and hands focus back to the
// control that opened it. The menu is opened by the toolbar button through a
// real click event, so its position is already on screen; nothing here depends
// on pointer coordinates.

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"

const MEMORY_DIR = ".unifia/memory"
const NOTE = "note.md"

async function openMemory(page: Page, gotoSession: () => Promise<void>, directory: string) {
  const dir = join(directory, MEMORY_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, NOTE), "# Note\n\nbody\n", "utf8")
  await installWorkbenchMock(page, {
    files: [
      { path: MEMORY_DIR, kind: "directory" },
      { path: `${MEMORY_DIR}/${NOTE}`, kind: "file" },
    ],
  })
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoSession()
  const toggle = page.locator('[data-v110="inspector-toggle"]')
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const inspectorTab = page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]')
  await inspectorTab.click()
  await expect(inspectorTab).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Memory", exact: true }).click()

  const note = page.locator(`[data-memory-note="${MEMORY_DIR}/${NOTE}"]`)
  await expect(note).toBeVisible()
  await note.click()
  return note
}

test("the Memory note menu takes focus and Escape closes it back onto its opener", async ({ page, gotoSession, directory }) => {
  const note = await openMemory(page, gotoSession, directory)

  const more = page.locator("[data-memory-more]")
  await expect(more).toBeVisible()
  await more.focus()
  await expect(more).toBeFocused()
  await page.keyboard.press("Enter")

  const menu = page.locator("[data-memory-menu]")
  await expect(menu).toBeVisible()
  await expect(page.locator("[data-memory-menu-item]").first()).toBeVisible()

  // A `role="menu"` that leaves focus on its opener is not operable: the first
  // Tab would leave the menu instead of walking it.
  expect(
    await page.evaluate(() => {
      const node = document.querySelector("[data-memory-menu]")
      return !!node && !!document.activeElement && node.contains(document.activeElement)
    }),
  ).toBe(true)

  await page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
  await expect(more).toBeFocused()
  // The note itself must not have been activated by the Escape.
  await expect(note).toHaveAttribute("data-active", "")
})

test("arrow keys walk the Memory note menu and stay inside it", async ({ page, gotoSession, directory }) => {
  await openMemory(page, gotoSession, directory)

  const more = page.locator("[data-memory-more]")
  await more.focus()
  await page.keyboard.press("Enter")

  const items = page.locator("[data-memory-menu-item]")
  await expect(items.first()).toBeVisible()
  await expect(items.first()).toBeFocused()

  await page.keyboard.press("ArrowDown")
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(items.nth(2)).toBeFocused()
  await page.keyboard.press("ArrowUp")
  await expect(items.nth(1)).toBeFocused()

  // The list wraps on both ends rather than leaking focus to the page.
  await page.keyboard.press("ArrowUp")
  await expect(items.first()).toBeFocused()
  await page.keyboard.press("ArrowUp")
  await expect(items.last()).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(page.locator("[data-memory-menu]")).toHaveCount(0)
})
