/* SPDX-License-Identifier: MIT */

// #93 — renaming a note rewrites the wikilinks that unambiguously point at it (v110 mockup: « les WikiLinks qui pointent
// sans ambiguïté vers cette note seront mis à jour automatiquement »). The rename and each rewritten link are governed
// proposals of the owner's knowledge route; the assertions read the note bytes back from the vault on disk.
//
// Ambiguity follows linkedMemoryNotes: when two notes share the old title, no rewrite happens — the link cannot be
// attributed to the renamed note.

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { MEMORY_VAULT_DIR, openMemoryPanel, writeGovernedVault } from "../memory-vault"

const A_ID = "018f6d2a-0000-7000-8000-0000000000e1"
const B_ID = "018f6d2a-0000-7000-8000-0000000000e2"
const DUP_ID = "018f6d2a-0000-7000-8000-0000000000e3"
const SUB_DUP_ID = "018f6d2a-0000-7000-8000-0000000000e4"

test.use({ backendIsolation: "owner" })

test("memory note rename refactors unambiguous wikilinks on real files", async ({ page, project }) => {
  await project.open({
    setup: (directory) =>
      writeGovernedVault(directory, [
        { locator: "a.md", id: A_ID, body: "# A\n\n[[B]] and [[B|bee]] and [[B#Part|section alias]] and [[Other]] and [[Dup]]\n" },
        { locator: "b.md", id: B_ID, body: "# B\n\nbody\n" },
        { locator: "dup.md", id: DUP_ID, body: "# Dup\n\none\n" },
        { locator: "sub/dup.md", id: SUB_DUP_ID, body: "# Dup\n\ntwo\n" },
      ]),
  })
  const vaultRoot = join(project.directory, MEMORY_VAULT_DIR)
  await openMemoryPanel(page)
  const vault = page.locator("[data-memory-vault]")
  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/b.md"]`)).toBeVisible()

  // Rename B -> C: every unambiguous [[B…]] target becomes [[C…]], shape preserved (alias, section), other targets kept.
  // The tree is listed again only after the links are rewritten, so the renamed row is the signal that both are done.
  await vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/b.md"]`).click({ button: "right" })
  await page.locator('[data-memory-menu-item="rename"]').click()
  const input = vault.locator('input[aria-label="Rename"]')
  await input.fill("C")
  await input.press("Enter")
  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/C.md"]`)).toBeVisible()
  expect(existsSync(join(vaultRoot, "b.md"))).toBe(false)
  expect(await readFile(join(vaultRoot, "a.md"), "utf8")).toContain(
    "[[C]] and [[C|bee]] and [[C#Part|section alias]] and [[Other]] and [[Dup]]",
  )

  // Rename Dup -> dup2 while sub/dup.md still carries the same title: the [[Dup]] link is ambiguous and stays untouched.
  await vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/dup.md"]`).click({ button: "right" })
  await page.locator('[data-memory-menu-item="rename"]').click()
  const dupInput = vault.locator('input[aria-label="Rename"]')
  await dupInput.fill("dup2")
  await dupInput.press("Enter")
  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/dup2.md"]`)).toBeVisible()
  expect(existsSync(join(vaultRoot, "dup.md"))).toBe(false)
  expect(existsSync(join(vaultRoot, "dup2.md"))).toBe(true)
  expect(await readFile(join(vaultRoot, "a.md"), "utf8")).toContain("[[Dup]]")
})
