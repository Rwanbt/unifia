/* SPDX-License-Identifier: MIT */

// v110 Memory editor contract (INTERACTIONS.md): edits autosave 700 ms
// after the last keystroke through the real CAS-protected file write route,
// the status chip reflects saved/unsaved, and pending edits reach the disk
// even when the user switches notes immediately. The vault listing comes
// from the workbench mock; the note bytes are real workspace files seeded
// on the e2e directory.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"

const MEMORY_DIR = ".unifia/memory"
const NOTE_A = "autosave-note.md"
const NOTE_B = "other-note.md"

test("memory note autosaves after 700 ms and survives an immediate note switch", async ({ page, gotoSession, directory }) => {
  const dir = join(directory, MEMORY_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, NOTE_A), "# Autosave\n\ninitial body\n", "utf8")
  await writeFile(join(dir, NOTE_B), "# Other\n\nanother note\n", "utf8")
  try {
    await installWorkbenchMock(page, {
      files: [
        { path: `${MEMORY_DIR}/${NOTE_A}`, kind: "file" },
        { path: `${MEMORY_DIR}/${NOTE_B}`, kind: "file" },
      ],
    })
    await page.setViewportSize({ width: 1400, height: 900 })
    await gotoSession()
    const toggle = page.getByRole("button", { name: "Toggle file tree" })
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await page.getByRole("tab", { name: "Inspector", exact: true }).click()
    await page.getByRole("button", { name: "Memory", exact: true }).click()

    // Wide triptych auto-selects the first note; switch to the editor.
    const chip = page.locator("[data-memory-save-state]")
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute("data-memory-save-state", "saved")
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    const editor = page.locator("[data-memory-note-pane] textarea")
    await expect(editor).toHaveValue("# Autosave\n\ninitial body\n")

    // Debounced autosave: the chip flips to unsaved then back to saved, and
    // the bytes on disk change without any explicit Save click.
    await editor.fill("# Autosave\n\nedited body\n")
    await expect(chip).toHaveAttribute("data-memory-save-state", "unsaved")
    await expect(chip).toHaveAttribute("data-memory-save-state", "saved")
    await expect.poll(async () => readFile(join(dir, NOTE_A), "utf8"), { timeout: 10_000 }).toBe("# Autosave\n\nedited body\n")

    // Pending edits are never lost on navigation: edit again, switch notes
    // immediately, and the first note still reaches the disk.
    await editor.fill("# Autosave\n\nsecond edit\n")
    await page.locator(`[data-memory-note="${MEMORY_DIR}/${NOTE_B}"]`).click()
    await expect.poll(async () => readFile(join(dir, NOTE_A), "utf8"), { timeout: 10_000 }).toBe("# Autosave\n\nsecond edit\n")
  } finally {
    await rm(join(dir, NOTE_A), { force: true })
    await rm(join(dir, NOTE_B), { force: true })
  }
})