/* SPDX-License-Identifier: MIT */

// Phase 5.2: the Code editor really hosts @codemirror/search (the acceptance
// matrix row "Search/Replace" was still "a tester"). The spec opens a real
// file, enters edit mode so the CodeMirror instance mounts, opens the search
// panel with Mod+F, asserts the matches, replaces one occurrence in the
// buffer, and closes the panel. Nothing is saved, so the disk stays as is.

import { test, expect } from "../fixtures"
import { modKey } from "../utils"

test("editor search and replace run through the real CodeMirror panel", async ({ page, gotoSession }) => {
  await gotoSession()
  const toggle = page.getByRole("button", { name: "Toggle file tree" })
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  const inspector = page.locator('[data-v110="inspector-content"]')
  const treeTabs = inspector.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')
  await treeTabs.getByRole("tab", { name: /^all files$/i }).click()
  const tree = treeTabs.locator('[data-slot="tabs-content"]:not([hidden])')
  const expand = async (name: string) => {
    const folder = tree.getByRole("button", { name, exact: true }).first()
    await expect(folder).toBeVisible()
    if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click()
    await expect(folder).toHaveAttribute("aria-expanded", "true")
  }
  await expand("packages")
  await expand("app")
  await expand("src")
  await expand("components")

  const file = tree.getByRole("button", { name: "file-tree.tsx", exact: true }).first()
  await expect(file).toBeVisible()
  await file.click()
  // The Review tab may stay active and hosts its own diff CodeMirror;
  // activate the file tab so the scoped editor is the file's one.
  await page.getByRole("tab", { name: /file-tree\.tsx/ }).first().click()

  // The viewer is read-only; the pencil mounts the real CodeMirror.
  await page.getByRole("button", { name: /Edit file|Modifier le fichier/ }).first().click()
  const editor = page.locator('[data-v110="code-editor"]:visible .cm-editor:visible').first()
  await expect(editor).toBeVisible()
  await editor.click()

  await page.keyboard.press(`${modKey}+f`)
  const panel = page.locator(".cm-panel.cm-search")
  await expect(panel).toBeVisible()
  await expect(editor.locator(".cm-content")).toContainText("FileTree")
  await panel.locator('input[name="search"]').pressSequentially("FileTree")
  await expect(page.locator(".cm-searchMatch").first()).toBeVisible()
  expect(await page.locator(".cm-searchMatch").count()).toBeGreaterThan(0)

  // Replace every occurrence in the buffer - never saved, so no file
  // changes. The search string no longer matches once replaced, so the
  // highlight count dropping to zero proves the buffer really changed
  // (the CodeMirror content DOM is virtualised, a textContent check would
  // only see the current viewport).
  await panel.locator('input[name="replace"]').pressSequentially("TreeFile")
  await panel.locator('button[name="replaceAll"]').click()
  await expect(page.locator(".cm-searchMatch")).toHaveCount(0)

  await panel.locator('button[name="close"]').click()
  await expect(panel).not.toBeVisible()
})