/* SPDX-License-Identifier: MIT */

// #93 — renaming a note rewrites the wikilinks that unambiguously point at it
// (v110 mockup: « les WikiLinks qui pointent sans ambiguïté vers cette note
// seront mis à jour automatiquement »). The vault listing comes from the
// workbench mock, but the note bodies are real files on disk read and written
// through the SDK file routes, so the assertion is about bytes, not calls.
//
// Ambiguity follows linkedMemoryNotes: when two notes share the old title, no
// rewrite happens — the link cannot be attributed to the renamed note.

import { readFile, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { installWorkbenchMock, readMockCalls } from "../fixtures/workbench-mock"

const MEMORY_DIR = ".unifia/memory"
const A = `${MEMORY_DIR}/a.md`
const B = `${MEMORY_DIR}/b.md`
const DUP = `${MEMORY_DIR}/dup.md`
const SUB_DUP = `${MEMORY_DIR}/sub/dup.md`

test("memory note rename refactors unambiguous wikilinks on real files", async ({ page, gotoSession, directory }) => {
  const dir = join(directory, MEMORY_DIR)
  await mkdir(join(dir, "sub"), { recursive: true })
  await writeFile(join(directory, A), "# A\n\n[[B]] and [[B|bee]] and [[B#Part|section alias]] and [[Other]] and [[Dup]]\n", "utf8")
  await writeFile(join(directory, B), "# B\n\nbody\n", "utf8")
  await writeFile(join(directory, DUP), "# Dup\n\none\n", "utf8")
  await writeFile(join(directory, SUB_DUP), "# Dup\n\ntwo\n", "utf8")
  try {
    await installWorkbenchMock(page, {
      files: [
        { path: MEMORY_DIR, kind: "directory" },
        { path: `${MEMORY_DIR}/sub`, kind: "directory" },
        { path: A, kind: "file" },
        { path: B, kind: "file" },
        { path: DUP, kind: "file" },
        { path: SUB_DUP, kind: "file" },
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
    const noteB = vault.locator(`[data-memory-note="${B}"]`)
    await expect(noteB).toBeVisible()

    // Rename B -> C: every unambiguous [[B…]] target becomes [[C…]], shape
    // preserved (alias, section, case-insensitive match), other targets kept.
    await noteB.click({ button: "right" })
    await page.locator('[data-memory-menu-item="rename"]').click()
    const input = vault.locator('input[aria-label="Rename"]')
    await input.fill("c")
    await input.press("Enter")
    await expect(vault.locator(`[data-memory-note="${MEMORY_DIR}/c.md"]`)).toBeVisible()
    await expect
      .poll(async () => await readFile(join(directory, A), "utf8"), { timeout: 15_000 })
      .toBe("# A\n\n[[C]] and [[C|bee]] and [[C#Part|section alias]] and [[Other]] and [[Dup]]\n")

    // Rename Dup -> Dup2 while sub/dup.md still carries the same title: the
    // [[Dup]] link is ambiguous and must stay untouched.
    await page.locator('[data-memory-note="' + DUP + '"]').click({ button: "right" })
    await page.locator('[data-memory-menu-item="rename"]').click()
    const dupInput = vault.locator('input[aria-label="Rename"]')
    await dupInput.fill("dup2")
    await dupInput.press("Enter")
    await expect(vault.locator(`[data-memory-note="${MEMORY_DIR}/dup2.md"]`)).toBeVisible()
    await expect
      .poll(async () => (await readMockCalls(page)).filter((call) => call.method === "renameFile").map((call) => call.args))
      .toContainEqual([DUP, `${MEMORY_DIR}/dup2.md`])
    expect(await readFile(join(directory, A), "utf8")).toContain("[[Dup]]")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
