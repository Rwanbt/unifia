/* SPDX-License-Identifier: MIT */

// Phase 9.5: the Memory vault offers a right-click menu backed by real capabilities only. Duplicate, move, rename,
// new note and delete are governed proposals of the owner's knowledge route; export downloads the note's Markdown;
// creating a folder is a workspace operation, so this spec keeps the workbench mock for the connection and the folder
// listing. Every effect is read back from the vault on disk. Pin and archive are absent because no runtime capability
// backs them.

import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { MEMORY_VAULT_DIR, openMemoryPanel, writeGovernedVault } from "../memory-vault"
import { installWorkbenchMock } from "../fixtures/workbench-mock"

const NOTE_ID = "018f6d2a-0000-7000-8000-0000000000f1"
const NOTE = "note.md"
const FOLDER = "projects"

test.use({ backendIsolation: "owner" })

test("memory vault context menu drives real duplicate, move, rename, export and delete", async ({ page, project }) => {
  await installWorkbenchMock(page, {
    files: [
      { path: MEMORY_VAULT_DIR, kind: "directory" },
      { path: `${MEMORY_VAULT_DIR}/${FOLDER}`, kind: "directory" },
      { path: `${MEMORY_VAULT_DIR}/${NOTE}`, kind: "file" },
    ],
  })
  await project.open({
    setup: async (directory) => {
      await writeGovernedVault(directory, [{ locator: NOTE, id: NOTE_ID, body: "# Note\n\nbody\n" }])
      await mkdir(join(directory, MEMORY_VAULT_DIR, FOLDER), { recursive: true })
    },
  })
  const vaultRoot = join(project.directory, MEMORY_VAULT_DIR)
  await openMemoryPanel(page)

  const vault = page.locator("[data-memory-vault]")
  const note = vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/${NOTE}"]`)
  const folder = vault.locator(`[data-memory-folder="${MEMORY_VAULT_DIR}/${FOLDER}"]`)
  await expect(note).toBeVisible()

  // Note menu: exactly the six runtime-backed actions.
  await note.click({ button: "right" })
  await expect(page.locator("[data-memory-menu]")).toBeVisible()
  await expect(page.locator("[data-memory-menu-item]")).toHaveCount(6)

  // Export downloads the note's Markdown under its own name.
  const downloadPromise = page.waitForEvent("download")
  await page.locator('[data-memory-menu-item="export"]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(NOTE)

  // Duplicate creates "<stem> copy.md" as a new governed note.
  await note.click({ button: "right" })
  await page.locator('[data-memory-menu-item="duplicate"]').click()
  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/note copy.md"]`)).toBeVisible()
  expect(existsSync(join(vaultRoot, "note copy.md"))).toBe(true)

  // Move to the projects folder: the note leaves the vault root.
  await note.click({ button: "right" })
  await page.locator('[data-memory-menu-item="move"]').click()
  await page.locator('[data-memory-menu-item="move-folder"]').click()
  const moved = vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/${FOLDER}/${NOTE}"]`)
  await expect(moved).toBeVisible()
  expect(existsSync(join(vaultRoot, FOLDER, NOTE))).toBe(true)
  expect(existsSync(join(vaultRoot, NOTE))).toBe(false)

  // Inline rename with Enter.
  await moved.click({ button: "right" })
  await page.locator('[data-memory-menu-item="rename"]').click()
  const input = vault.locator('input[aria-label="Rename"]')
  await input.fill("Renamed")
  await input.press("Enter")
  const renamed = vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/${FOLDER}/Renamed.md"]`)
  await expect(renamed).toBeVisible()
  expect(existsSync(join(vaultRoot, FOLDER, "Renamed.md"))).toBe(true)
  expect(existsSync(join(vaultRoot, FOLDER, NOTE))).toBe(false)

  // Folder menu: exactly two creation actions. A new note is a governed create; a new folder is a workspace mkdir.
  await folder.click({ button: "right" })
  await expect(page.locator("[data-memory-menu-item]")).toHaveCount(2)
  await page.locator('[data-memory-menu-item="newNote"]').click()
  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/${FOLDER}/New note.md"]`)).toBeVisible()
  expect(existsSync(join(vaultRoot, FOLDER, "New note.md"))).toBe(true)
  await folder.click({ button: "right" })
  await page.locator('[data-memory-menu-item="newFolder"]').click()
  await expect.poll(() => existsSync(join(vaultRoot, FOLDER, "New folder"))).toBe(true)

  // The header button creates a root note; delete removes the note from the tree and from the vault.
  await page.locator("[data-memory-new-note]").click()
  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/New note.md"]`)).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await renamed.click({ button: "right" })
  await page.locator('[data-memory-menu-item="delete"]').click()
  await expect(renamed).not.toBeAttached()
  expect(existsSync(join(vaultRoot, FOLDER, "Renamed.md"))).toBe(false)
})
