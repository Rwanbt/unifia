// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { test, expect } from "../fixtures"
import { cleanupTestProject, createTestProject, openSidebar } from "../actions"
import {
  dropdownMenuContentSelector,
  projectCloseMenuSelector,
  projectDisclosureSelector,
  projectMenuTriggerSelector,
  projectRowSelector,
} from "../selectors"
import { dirSlug } from "../utils"

const projectToggleSelector = (slug: string) => `${projectRowSelector(slug)} .v68-project-toggle`

test("Enter on a project disclosure toggles it and keeps focus on it", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  const other = await createTestProject()
  const slug = dirSlug(other)

  try {
    await project.open({ extra: [other] })
    await openSidebar(page)

    const disclosure = page.locator(projectDisclosureSelector(slug)).first()
    const row = page.locator(projectRowSelector(slug)).first()
    await disclosure.focus()
    const wasOpen = await row.evaluate((el) => el.classList.contains("open"))

    await page.keyboard.press("Enter")

    await expect.poll(() => row.evaluate((el) => el.classList.contains("open"))).toBe(!wasOpen)
    await expect(disclosure).toBeFocused()
  } finally {
    await cleanupTestProject(other)
  }
})

test("Shift+Tab from a project toggle goes back to that project's menu", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  const other = await createTestProject()
  const slug = dirSlug(other)

  try {
    await project.open({ extra: [other] })
    await openSidebar(page)

    const toggle = page.locator(projectToggleSelector(slug)).first()
    await toggle.focus()
    await page.keyboard.press("Shift+Tab")

    await expect(page.locator(projectMenuTriggerSelector(slug)).first()).toBeFocused()
  } finally {
    await cleanupTestProject(other)
  }
})

test("a project menu opens from the keyboard and Escape returns focus to its trigger", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()
  await openSidebar(page)

  const trigger = page.locator(projectMenuTriggerSelector(project.slug)).first()
  await trigger.focus()
  await page.keyboard.press("Enter")

  const menu = page.locator(dropdownMenuContentSelector).filter({ has: page.locator(projectCloseMenuSelector(project.slug)) }).first()
  await expect(menu).toBeVisible()

  await page.keyboard.press("Escape")

  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test("after another project is closed, this project's menu still acts on this project", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await project.open({ extra: [other] })
    await openSidebar(page)

    await page.locator(projectMenuTriggerSelector(otherSlug)).first().click()
    await page.locator(projectCloseMenuSelector(otherSlug)).first().click()
    await expect(page.locator(projectRowSelector(otherSlug))).toHaveCount(0)

    await page.locator(projectMenuTriggerSelector(project.slug)).first().click()

    await expect(page.locator(projectCloseMenuSelector(project.slug))).toHaveCount(1)
    await expect(page.locator(projectCloseMenuSelector(otherSlug))).toHaveCount(0)
  } finally {
    await cleanupTestProject(other)
  }
})
