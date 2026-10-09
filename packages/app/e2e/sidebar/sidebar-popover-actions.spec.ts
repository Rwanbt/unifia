import { test, expect } from "../fixtures"
import {
  defocus,
  cleanupTestProject,
  createTestProject,
  openSidebar,
} from "../actions"
import { projectDisclosureSelector, projectRowSelector } from "../selectors"
import { dirSlug } from "../utils"

// The "collapsed sidebar popover stays open when archiving a session" test was
// removed with the feature: the rail's per-project chips, whose hover opened
// that popover, were deleted on the owner's instruction (6632abdd69). A
// collapsed sidebar now shows only the mode rail, so there is no project row
// to hover.

test("opening another project disclosure leaves the active route unchanged", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const slug = dirSlug(other)

  try {
    await project.open({ extra: [other] })
    await openSidebar(page)

    const projectButton = page.locator(projectDisclosureSelector(slug)).first()
    const projectRow = page.locator(projectRowSelector(slug)).first()
    const activeUrl = page.url()

    await expect(projectButton).toBeVisible()
    await projectButton.click()
    await expect(projectRow).not.toHaveClass(/open/)
    await projectButton.click()
    await expect(projectRow).toHaveClass(/open/)
    await expect(page).toHaveURL(activeUrl)
  } finally {
    await cleanupTestProject(other)
  }
})

test("project disclosure opens with keyboard activation", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const slug = dirSlug(other)

  try {
    await project.open({ extra: [other] })
    await openSidebar(page)

    const projectButton = page.locator(projectDisclosureSelector(slug)).first()
    const projectRow = page.locator(projectRowSelector(slug)).first()

    await expect(projectButton).toBeVisible()
    await projectButton.click()
    await expect(projectRow).not.toHaveClass(/open/)
    await defocus(page)

    let hit = false
    for (let i = 0; i < 20; i++) {
      hit = await projectButton.evaluate((el) => {
        return el.matches(":focus") || !!el.parentElement?.matches(":focus")
      })
      if (hit) break
      await page.keyboard.press("Tab")
    }

    expect(hit).toBe(true)

    await page.keyboard.press("Enter")
    await expect(projectRow).toHaveClass(/open/)
    await expect(page).toHaveURL(new RegExp(`/${project.slug}/session`))
  } finally {
    await cleanupTestProject(other)
  }
})
