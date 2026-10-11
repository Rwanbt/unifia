/* SPDX-License-Identifier: MIT */

// v110 Memory editor contract (INTERACTIONS.md): edits autosave 700 ms after the last keystroke through the owner's
// governed update route, the status chip reflects saved/unsaved, and pending edits reach the disk even when the user
// switches notes immediately. The note bytes are read back from the vault on disk.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { MEMORY_VAULT_DIR, openMemoryPanel, writeGovernedVault } from "../memory-vault"

const AUTOSAVE_ID = "018f6d2a-0000-7000-8000-0000000000d1"
const OTHER_ID = "018f6d2a-0000-7000-8000-0000000000d2"

test.use({ backendIsolation: "owner" })

test("memory note autosaves after 700 ms and survives an immediate note switch", async ({ page, project }) => {
  await project.open({
    setup: (directory) =>
      writeGovernedVault(directory, [
        { locator: "autosave-note.md", id: AUTOSAVE_ID, body: "# Autosave\n\ninitial body\n" },
        { locator: "other-note.md", id: OTHER_ID, body: "# Other\n\nanother note\n" },
      ]),
  })
  const noteFile = join(project.directory, MEMORY_VAULT_DIR, "autosave-note.md")
  await openMemoryPanel(page)

  // The first note opens selected; switch to the editor.
  const chip = page.locator("[data-memory-save-state]")
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute("data-memory-save-state", "saved")
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  const editor = page.locator("[data-memory-note-pane] textarea")
  // ADR-084: the editor is split - data-memory-title-input owns the `# heading` and the textarea owns the `body` slice
  // of the file. For "# Autosave\n\ninitial body\n" the leading blank line is part of the body, so the textarea holds
  // "\ninitial body\n" and the heading is NOT part of it.
  await expect(page.locator("[data-memory-title-input]")).toHaveValue("Autosave")
  await expect(editor).toHaveValue("\ninitial body\n")

  // Debounced autosave: the chip flips to unsaved then back to saved, and the note on disk changes with no Save click.
  await editor.fill("\nedited body\n")
  await expect(chip).toHaveAttribute("data-memory-save-state", "unsaved")
  await expect(chip).toHaveAttribute("data-memory-save-state", "saved")
  await expect.poll(() => readFile(noteFile, "utf8"), { timeout: 10_000 }).toContain("edited body")
  const saved = await readFile(noteFile, "utf8")
  // The governed write keeps the note's identity (the writer may rewrite the frontmatter's quoting, so the value is checked).
  expect(saved).toContain(AUTOSAVE_ID)
  expect(saved).not.toContain("initial body")

  // Pending edits are never lost on navigation: edit again, switch notes immediately, and the first note still reaches
  // the disk.
  await editor.fill("\nsecond edit\n")
  await page.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/other-note.md"]`).click()
  await expect.poll(() => readFile(noteFile, "utf8"), { timeout: 10_000 }).toContain("second edit")
})
