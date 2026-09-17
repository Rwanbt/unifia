/* SPDX-License-Identifier: MIT */

// Phase 9.5: the Memory vault offers a right-click menu backed by real
// workspace capabilities only. Rename/move/duplicate/delete go through the
// WorkbenchClient routes the mock records; export downloads the real
// Markdown; new note/folder create real entries. Pin/archive are absent
// because no runtime capability backs them.

import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { installWorkbenchMock, readMockCalls } from "../fixtures/workbench-mock"

const MEMORY_DIR = ".unifia/memory"
const NOTE = "note.md"
const FOLDER = "projects"


test("memory vault context menu drives real rename, duplicate, move, export and delete", async ({ page, gotoSession, directory }) => {
  const dir = join(directory, MEMORY_DIR)
  await mkdir(join(dir, FOLDER), { recursive: true })
  await writeFile(join(dir, NOTE), "# Note\n\nbody\n", "utf8")
  try {
    await installWorkbenchMock(page, {
      files: [
        { path: MEMORY_DIR, kind: "directory" },
        { path: `${MEMORY_DIR}/${FOLDER}`, kind: "directory" },
        { path: `${MEMORY_DIR}/${NOTE}`, kind: "file" },
      ],
    })
    await page.setViewportSize({ width: 1400, height: 900 })
    await gotoSession()
    const toggle = page.getByRole("button", { name: "Toggle file tree" })
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await page.getByRole("tab", { name: "Inspector", exact: true }).click()
    await page.getByRole("button", { name: "Memory", exact: true }).click()

    const vault = page.locator("[data-memory-vault]")
    const note = vault.locator(`[data-memory-note="${MEMORY_DIR}/${NOTE}"]`)
    const folder = vault.locator(`[data-memory-folder="${MEMORY_DIR}/${FOLDER}"]`)
    await expect(note).toBeVisible()

    // Note menu: exactly the six runtime-backed actions.
    await note.click({ button: "right" })
    await expect(page.locator("[data-memory-menu]")).toBeVisible()
    await expect(page.locator("[data-memory-menu-item]")).toHaveCount(6)

    // Export downloads the real Markdown bytes.
    const downloadPromise = page.waitForEvent("download")
    await page.locator('[data-memory-menu-item="export"]').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(NOTE)

    // Duplicate creates "<stem> copy.md" through createFiles.
    await note.click({ button: "right" })
    await page.locator('[data-memory-menu-item="duplicate"]').click()
    await expect(vault.locator(`[data-memory-note="${MEMORY_DIR}/note copy.md"]`)).toBeVisible()
    await expect
      .poll(async () => (await readMockCalls(page)).filter((call) => call.method === "createFiles").map((call) => call.args[0]))
      .toContain(`${MEMORY_DIR}/note copy.md`)

    // Move to the projects folder through the rename route.
    await note.click({ button: "right" })
    await page.locator('[data-memory-menu-item="move"]').click()
    await page.locator('[data-memory-menu-item="move-folder"]').click()
    const moved = vault.locator(`[data-memory-note="${MEMORY_DIR}/${FOLDER}/${NOTE}"]`)
    await expect(moved).toBeVisible()
    await expect
      .poll(async () => (await readMockCalls(page)).filter((call) => call.method === "renameFile").map((call) => call.args))
      .toContainEqual([`${MEMORY_DIR}/${NOTE}`, `${MEMORY_DIR}/${FOLDER}/${NOTE}`])

    // Inline rename with Enter.
    await moved.click({ button: "right" })
    await page.locator('[data-memory-menu-item="rename"]').click()
    const input = vault.locator('input[aria-label="Rename"]')
    await input.fill("Renamed")
    await input.press("Enter")
    const renamed = vault.locator(`[data-memory-note="${MEMORY_DIR}/${FOLDER}/Renamed.md"]`)
    await expect(renamed).toBeVisible()
    await expect
      .poll(async () => (await readMockCalls(page)).filter((call) => call.method === "renameFile").map((call) => call.args))
      .toContainEqual([`${MEMORY_DIR}/${FOLDER}/${NOTE}`, `${MEMORY_DIR}/${FOLDER}/Renamed.md`])

    // Folder menu: exactly two creation actions, both real.
    await folder.click({ button: "right" })
    await expect(page.locator("[data-memory-menu-item]")).toHaveCount(2)
    await page.locator('[data-memory-menu-item="newNote"]').click()
    await expect(vault.locator(`[data-memory-note="${MEMORY_DIR}/${FOLDER}/New note.md"]`)).toBeVisible()
    await folder.click({ button: "right" })
    await page.locator('[data-memory-menu-item="newFolder"]').click()
    await expect.poll(() => existsSync(join(dir, FOLDER, "New folder"))).toBe(true)

    // Header button creates a root note; delete removes through removeFiles.
    await page.locator("[data-memory-new-note]").click()
    await expect(vault.locator(`[data-memory-note="${MEMORY_DIR}/New note.md"]`)).toBeVisible()
    page.once("dialog", (dialog) => dialog.accept())
    await renamed.click({ button: "right" })
    await page.locator('[data-memory-menu-item="delete"]').click()
    await expect(renamed).not.toBeAttached()
    await expect
      .poll(async () => (await readMockCalls(page)).filter((call) => call.method === "removeFiles").map((call) => call.args))
      .toContainEqual([[`${MEMORY_DIR}/${FOLDER}/Renamed.md`]])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})