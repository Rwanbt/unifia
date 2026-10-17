/* SPDX-License-Identifier: MIT */

// #553 (UI13/UI14) — WCAG 2.1 A/AA gate for the two RC-1 surfaces that still
// had no axe scan after the Home/Chat gate. Same shared harness
// (design/axe.ts, one recorded rule: the app-wide color-contrast token debt,
// attached to each report instead of muted) and the same scoping discipline:
// each scan measures its surface root, never the shared chrome.
//
// Both tests mount the real surface first. The Code editor only exists when a
// tab with a path is open (same path as code.spec.ts), and the Memory pane
// only carries a note when the vault listing has one - the listing comes from
// the workbench mock, the note bytes are seeded on the e2e directory, exactly
// as the memory note suite does it. A scan over an empty shell would measure
// nothing worth gating.

import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { expectNoNewViolations } from "../design/axe"
import { openInspector } from "./inspector"

async function openFile(page: import("@playwright/test").Page) {
  await openInspector(page, "explorer")
  const tree = page.locator('[data-v110="inspector-content"] [data-v110="inspector-explorer"]')
  for (const folder of ["packages", "app", "src", "components"]) {
    const node = tree.getByRole("button", { name: folder, exact: true }).first()
    await expect(node).toBeVisible()
    if ((await node.getAttribute("aria-expanded")) === "false") await node.click()
    await expect(node).toHaveAttribute("aria-expanded", "true")
  }
  const file = tree.getByRole("button", { name: "file-tree.tsx", exact: true }).first()
  await expect(file).toBeVisible()
  await file.click()
}

test("the code surface has no new WCAG violations once a file is open", async ({ page, gotoSession }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoSession()
  await openFile(page)
  const editor = page.locator('[data-v110="code-editor"]')
  await expect(editor).toBeVisible()
  await expectNoNewViolations(page, testInfo, "Code surface", '[data-v110="code-editor"]')
})

test("the memory surface has no new WCAG violations once a note is open", async ({ page, gotoSession, directory }, testInfo) => {
  const dir = join(directory, ".unifia/memory")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "a11y-note.md"), "# A11y note\n\nscanned body\n", "utf8")
  try {
    await installWorkbenchMock(page, { files: [{ path: ".unifia/memory/a11y-note.md", kind: "file" }] })
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSession()
    const toggle = page.locator('[data-v110="inspector-toggle"]')
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    const inspectorTab = page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]')
    await inspectorTab.click()
    await expect(inspectorTab).toHaveAttribute("aria-selected", "true")
    await page.getByRole("button", { name: "Memory", exact: true }).click()
    const grid = page.locator('[data-v110="memory-grid"]')
    await expect(grid).toBeVisible()
    // The wide triptych auto-selects the first note; the pane must carry it
    // before the scan, or this measures the empty state instead.
    await expect(page.locator("[data-memory-note-pane]")).toBeVisible()
    await expectNoNewViolations(page, testInfo, "Memory surface", '[data-v110="memory-grid"]')
  } finally {
    await rm(join(dir, "a11y-note.md"), { force: true })
  }
})
