/* SPDX-License-Identifier: MIT */

// Phase 9 remainder: the Memory vault renders the workspace tree (folders +
// notes) and a note dragged onto a folder reaches the real workspace rename
// route. The web e2e harness has no native workbench bridge, so this spec
// installs the workbench mock (test infrastructure, see workbench-mock.ts)
// with a vault fixture and asserts the rename call the browser actually made -
// never a fabricated DOM-only move.

import { test, expect } from "../fixtures"
import { installWorkbenchMock, readMockCalls } from "../fixtures/workbench-mock"

const FILES = [
  { path: ".unifia/memory/00 - Inbox", kind: "directory" as const },
  { path: ".unifia/memory/10 - Projects", kind: "directory" as const },
  { path: ".unifia/memory/10 - Projects/Unifia", kind: "directory" as const },
  { path: ".unifia/memory/10 - Projects/Unifia/Vision.md", kind: "file" as const },
  { path: ".unifia/memory/README.md", kind: "file" as const },
]

test("memory vault shows the folder tree and moves a note onto a folder", async ({ page, gotoSession }) => {
  await installWorkbenchMock(page, { files: FILES })
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoSession()
  // The inspector frame starts collapsed; open it before switching to the
  // Inspector pane that hosts the Memory button (same entry path as a4).
  const toggle = page.getByRole("button", { name: "Toggle file tree" })
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("tab", { name: "Inspector", exact: true }).click()
  await page.getByRole("button", { name: "Memory", exact: true }).click()

  const vault = page.locator("[data-memory-vault]")
  await expect(vault).toBeVisible()
  const folder = vault.locator('[data-memory-folder=".unifia/memory/10 - Projects/Unifia"]')
  const note = vault.locator('[data-memory-note=".unifia/memory/README.md"]')
  await expect(folder).toBeVisible()
  await expect(note).toBeVisible()
  // Folders before notes, and the folder badge counts the subtree notes.
  await expect(vault.locator('[data-memory-folder=".unifia/memory/10 - Projects"]')).toContainText("1")

  // Collapse re-hides the subtree row; expanding brings it back.
  const projects = vault.locator('[data-memory-folder=".unifia/memory/10 - Projects"]')
  await projects.click()
  await expect(folder).not.toBeVisible()
  await projects.click()
  await expect(folder).toBeVisible()

  // DnD: dropping the note on the folder issues one rename through the client.
  await note.dragTo(folder)
  await expect
    .poll(async () => (await readMockCalls(page)).filter((call) => call.method === "renameFile"))
    .toEqual([
      {
        method: "renameFile",
        args: [".unifia/memory/README.md", ".unifia/memory/10 - Projects/Unifia/README.md"],
      },
    ])
  await expect(vault.locator('[data-memory-note=".unifia/memory/10 - Projects/Unifia/README.md"]')).toBeVisible()
  await expect(vault.locator('[data-memory-note=".unifia/memory/README.md"]')).not.toBeAttached()
})