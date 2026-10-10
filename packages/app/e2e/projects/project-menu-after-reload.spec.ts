// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { test, expect } from "../fixtures"
import { openProjectMenu, openSidebar } from "../actions"
import { projectWorkspacesToggleSelector } from "../selectors"

// The project list reloads after a page reload. The project row used to be re-created
// during that load, which closed an open project menu and detached its items. This opens
// the menu straight after the reload, on purpose, and does not wait for the list to settle.
test("project menu stays usable right after a reload", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()
  await openSidebar(page)

  await page.reload()
  await openSidebar(page)

  const menu = await openProjectMenu(page, project.slug)
  const toggle = menu.locator(projectWorkspacesToggleSelector(project.slug)).first()
  await expect(toggle).toHaveText(/Enable workspaces/)
  await toggle.click()

  await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()
})
