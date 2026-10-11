/* SPDX-License-Identifier: MIT */

// Phase 9 remainder, governed: the Memory vault lists the notes the owner may read, and a note dragged onto a folder
// is moved by the owner's knowledge route (POST /knowledge/propose), never by the file API. The backend is protected,
// so the page reaches those routes only with the owner credentials the app stores for that connection.

import fs from "node:fs"
import path from "node:path"
import { test, expect } from "../fixtures"
import { MEMORY_REASONS } from "../../src/pages/session/memory-note-writes"
import { MEMORY_VAULT_DIR, writeGovernedVault } from "../memory-vault"

const ROOT_NOTE_ID = "018f6d2a-0000-7000-8000-000000000001"
const VISION_NOTE_ID = "018f6d2a-0000-7000-8000-000000000002"
const PROPOSE_PATH = "/knowledge/propose"

test.use({ backendIsolation: "owner" })

test("memory vault shows the governed notes and moves a note onto a folder through the owner's route", async ({ page, project }) => {
  await project.open({
    setup: (directory) =>
      writeGovernedVault(directory, [
        { locator: "README.md", id: ROOT_NOTE_ID, body: "# Memory\n\nRoot note.\n" },
        { locator: "10 - Projects/Unifia/Vision.md", id: VISION_NOTE_ID, body: "# Vision\n\nUnifia.\n" },
      ]),
  })

  // The inspector frame starts collapsed; open it before switching to the Inspector pane that hosts the Memory button.
  const toggle = page.locator('[data-v110="inspector-toggle"]')
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const inspectorTab = page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]')
  await inspectorTab.click()
  await expect(inspectorTab).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Memory", exact: true }).click()

  const vault = page.locator("[data-memory-vault]")
  await expect(vault).toBeVisible()
  const folder = vault.locator(`[data-memory-folder="${MEMORY_VAULT_DIR}/10 - Projects/Unifia"]`)
  const root = vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/README.md"]`)
  await expect(folder).toBeVisible()
  await expect(root).toBeVisible()
  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/10 - Projects/Unifia/Vision.md"]`)).toBeVisible()
  // A folder's badge counts the notes under it: "10 - Projects" holds Vision.
  await expect(vault.locator(`[data-memory-folder="${MEMORY_VAULT_DIR}/10 - Projects"]`)).toContainText("1")

  // Collapsing hides the subtree row; expanding brings it back.
  const projects = vault.locator(`[data-memory-folder="${MEMORY_VAULT_DIR}/10 - Projects"]`)
  await projects.click()
  await expect(folder).not.toBeVisible()
  await projects.click()
  await expect(folder).toBeVisible()

  // Dropping the root note on the folder proposes one move to the owner's route, and the route applies it.
  const proposal = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === PROPOSE_PATH,
  )
  await root.dragTo(folder)
  const response = await proposal
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({
    reason: MEMORY_REASONS.move,
    intent: {
      kind: "move",
      targetId: ROOT_NOTE_ID,
      expectedVersionHash: expect.any(String),
      targetLocator: "10 - Projects/Unifia/README.md",
    },
  })
  expect(await response.json()).toMatchObject({ applied: true })

  await expect(vault.locator(`[data-memory-note="${MEMORY_VAULT_DIR}/10 - Projects/Unifia/README.md"]`)).toBeVisible()
  await expect(root).not.toBeAttached()
  // The move reached the vault on disk, not only the panel.
  const vaultRoot = path.join(project.directory, MEMORY_VAULT_DIR)
  expect(fs.existsSync(path.join(vaultRoot, "10 - Projects", "Unifia", "README.md"))).toBe(true)
  expect(fs.existsSync(path.join(vaultRoot, "README.md"))).toBe(false)
})
