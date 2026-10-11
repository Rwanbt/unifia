/* SPDX-License-Identifier: MIT */
import fs from "node:fs/promises"
import path from "node:path"
import { expect, type Page } from "./fixtures"

/** The vault folder the Memory panel and the knowledge routes read, relative to the project. */
export const MEMORY_VAULT_DIR = ".unifia/memory"

export type GovernedNoteSeed = {
  /** Path inside the vault, as the knowledge routes name it (no vault prefix). */
  locator: string
  /** A canonical UUIDv7: the vault parser rejects any other id. */
  id: string
  body: string
}

/**
 * The smallest note the governed reader accepts: exactly the frontmatter the vault parser requires, and no key it
 * does not know (the frontmatter schema is strict).
 */
export function governedNoteText(note: Pick<GovernedNoteSeed, "id" | "body">): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${note.id}"`,
    "unifia_type: decision",
    "unifia_lifecycle: active",
    'unifia_created_at: "2026-10-11T00:00:00Z"',
    'unifia_updated_at: "2026-10-11T00:00:00Z"',
    "unifia_project_ref: unifia",
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    note.body,
  ].join("\n")
}

/**
 * Writes governed notes into the project's vault on disk. The owner's routes read the vault like any other file,
 * so the test seeds it the same way a user's vault is filled.
 */
export async function writeGovernedVault(directory: string, notes: readonly GovernedNoteSeed[]) {
  for (const note of notes) {
    const file = path.join(directory, MEMORY_VAULT_DIR, note.locator)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, governedNoteText(note))
  }
}

/**
 * Opens the Memory panel from the workspace inspector, at a viewport wide enough for the three-column layout. The
 * inspector frame starts collapsed, so it is opened first.
 */
export async function openMemoryPanel(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const toggle = page.locator('[data-v110="inspector-toggle"]')
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const inspectorTab = page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]')
  await inspectorTab.click()
  await expect(inspectorTab).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Memory", exact: true }).click()
}
