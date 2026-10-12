import { test, expect } from "../fixtures"
import { serverNamePattern } from "../utils"

test("home renders and shows core entrypoints", async ({ page }) => {
  await page.goto("/")
  const nav = page.locator('[data-component="sidebar-nav-desktop"]')

  await expect(page.getByRole("button", { name: "Open project", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Get started with Unifia" })).toBeVisible()
  await expect(nav).not.toBeVisible()
  await expect(page.locator('[data-v110="home-modes-row"]').getByRole("button")).toHaveCount(6)
  await expect(page.getByRole("button", { name: serverNamePattern })).toBeVisible()
})

test("server picker dialog opens from home", async ({ page }) => {
  await page.goto("/")

  const trigger = page.getByRole("button", { name: serverNamePattern })
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAccessibleName(/^Switch server: /)
  await trigger.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
})
