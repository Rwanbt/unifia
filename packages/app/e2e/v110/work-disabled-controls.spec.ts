/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

test.use({ backendIsolation: "work-disabled-controls" })

test("deferred Work controls are disabled and not keyboard focusable in RC-1", async ({
  page,
  directory,
  gotoSession,
}) => {
  await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
  await page.setViewportSize({ width: 1400, height: 800 })
  await gotoSession()
  await page.goto(`${dirPath(directory)}/work`)
  await page.getByRole("radio", { name: "Editor" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()

  const deferred = page.locator('[data-workbench-surface="work"] button[aria-disabled="true"]')
  await expect(deferred.first()).toBeVisible()
  for (const button of await deferred.all()) {
    await expect(button).toBeDisabled()
    await expect(button).not.toHaveAttribute("title", /coming soon|bientôt/i)
  }

  await deferred.first().evaluate((button) => button.focus())
  await expect(deferred.first()).not.toBeFocused()
})
