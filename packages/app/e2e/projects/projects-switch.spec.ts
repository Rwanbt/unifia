import { base64Decode } from "@unifia/util/encode"
import { test, expect } from "../fixtures"
import {
  defocus,
  createTestProject,
  cleanupTestProject,
  openProjectFromSidebar,
  openSidebar,
  setWorkspacesEnabled,
  waitSession,
  waitSlug,
} from "../actions"
import { workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { dirSlug, resolveDirectory } from "../utils"

test("can switch between projects from the sidebar", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await project.open({ extra: [other] })

    const currentSlug = dirSlug(project.directory)
    await openProjectFromSidebar(page, other)

    await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

    await openProjectFromSidebar(page, project.directory)

    await expect(page).toHaveURL(new RegExp(`/${currentSlug}/session`))
  } finally {
    await cleanupTestProject(other)
  }
})

test("reopening a project from the sidebar returns to its workspace session", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)
  try {
    await project.open({ extra: [other] })
    await defocus(page)
    await setWorkspacesEnabled(page, project.slug, true)
    await openSidebar(page)
    await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()

    await page.getByRole("button", { name: "New workspace" }).first().click()

    const raw = await waitSlug(page, [project.slug])
    const dir = base64Decode(raw)
    if (!dir) throw new Error(`Failed to decode workspace slug: ${raw}`)
    const space = await resolveDirectory(dir)
    const next = dirSlug(space)
    project.trackDirectory(space)
    await openSidebar(page)

    const item = page.locator(`${workspaceItemSelector(next)}, ${workspaceItemSelector(raw)}`).first()
    await expect(item).toBeVisible()
    await item.hover()

    const btn = page.locator(`${workspaceNewSessionSelector(next)}, ${workspaceNewSessionSelector(raw)}`).first()
    await expect(btn).toBeVisible()
    await btn.click({ force: true })

    await waitSession(page, { directory: space })

    const created = await project.user("test")

    await expect(page).toHaveURL(new RegExp(`/${next}/session/${created}(?:[/?#]|$)`))

    await openProjectFromSidebar(page, other)
    await waitSession(page, { directory: other })

    await openProjectFromSidebar(page, project.directory, { sessionID: created })

    await waitSession(page, { directory: space, sessionID: created })
    await expect(page).toHaveURL(new RegExp(`/session/${created}(?:[/?#]|$)`))
  } finally {
    await cleanupTestProject(other)
  }
})
