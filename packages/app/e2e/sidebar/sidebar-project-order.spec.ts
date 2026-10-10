// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { cleanupTestProject, createTestProject, openSidebar } from "../actions"
import { projectCloseMenuSelector, projectMenuTriggerSelector } from "../selectors"
import { dirSlug } from "../utils"

type E2EProjectsWindow = Window & {
  __opencode_e2e?: { projects?: { move?: (directory: string, toIndex: number) => void } }
}

const visibleRowSlugs = (page: Page) =>
  page.locator('[data-component="sidebar-nav-desktop"] [data-v68-project]').evaluateAll((rows) =>
    rows
      .filter((row) => (row as HTMLElement).offsetParent !== null)
      .map((row) => row.getAttribute("data-v68-project") ?? ""),
  )

// A project menu is open when the list is reordered. The reorder changes the order of the rows,
// and the menu must stay on the project it was opened for, with its items acting on that project.
// The reorder is the product's own action, reached through a test-only handle the product never reads.
test("a reorder while a project menu is open keeps that menu on its own project", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await project.open({ extra: [other] })
    await openSidebar(page)

    await page.locator(projectMenuTriggerSelector(project.slug)).first().click()
    const closeItem = page.locator(projectCloseMenuSelector(project.slug)).first()
    await expect(closeItem).toBeVisible()

    // Move the row that is second to the top. Moving the first row to the top would not change the order.
    const before = await visibleRowSlugs(page)
    expect(before).toHaveLength(2)
    const movingSlug = before[1]!
    const movingDirectory = movingSlug === otherSlug ? other : project.directory
    await page.evaluate((directory) => {
      ;(window as E2EProjectsWindow).__opencode_e2e?.projects?.move?.(directory, 0)
    }, movingDirectory)

    await expect.poll(() => visibleRowSlugs(page)).toEqual([movingSlug, before[0]])

    // The open menu is still the one for this project, and its items are not the other project's.
    await expect(closeItem).toBeVisible()
    await expect(page.locator(projectCloseMenuSelector(otherSlug))).toHaveCount(0)
  } finally {
    await cleanupTestProject(other)
  }
})
