/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"
import { VALID_SPEC } from "../design/surface"

test("multimode navigation keeps the route and projection aligned", async ({ page, directory, slug }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))

  // ADR-1041 supersedes ADR-1033: Automate is reachable from the rail whenever
  // the workspace has `workflow.run` granted, and it is always reachable in a
  // dev build — which is what the e2e harness runs. This test still drives only
  // Work and Design, by choice: they are the two surfaces whose conversational
  // entry point it asserts.
  //
  // Since 1c76014887 / 1171ccd387 every mode shares one chat pane and one
  // session (session.tsx): the per-mode WorkbenchChat / WorkbenchThread
  // entry points are gone, so each mode is asserted against the shared
  // conversation header and composer it actually renders.
  const sharedChat = async () => {
    await expect(page.locator('[data-v110="mode-chat-head"]:visible')).toBeVisible()
    await expect(page.locator('[data-v110="prompt-composer"]:visible').first()).toBeVisible()
  }
  await page.getByRole("button", { name: "work mode" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/work(?:[/?#]|$)`))
  await expect(page.locator(`[data-workbench-mode="work"]`).first()).toBeVisible()
  await sharedChat()

  await page.getByRole("button", { name: "design mode" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/design(?:[/?#]|$)`))
  await expect(page.locator(`[data-workbench-mode="design"]`).first()).toBeVisible()
  await sharedChat()

  await page.getByRole("button", { name: "code mode" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
  await expect(page.locator(`[data-workbench-mode="code"]`).first()).toBeVisible()
})

test("mode rail exposes aria-pressed and a labeled navigation group (A11Y-001)", async ({ page, directory, slug }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))

  await expect(page.getByRole("navigation", { name: "Workspace modes" })).toBeVisible()
  await expect(page.getByRole("button", { name: "code mode", pressed: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "work mode", pressed: false })).toBeVisible()

  await page.getByRole("button", { name: "work mode" }).click()
  await expect(page).toHaveURL(new RegExp(`/${slug}/work(?:[/?#]|$)`))
  await expect(page.getByRole("button", { name: "work mode", pressed: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "code mode", pressed: false })).toBeVisible()
})

test("unknown mode never renders an empty projection", async ({ page, directory }) => {
  await page.goto(`${dirPath(directory)}/unknown-mode`)
  await expect(page.locator("[data-workbench-error], [data-workbench-mode=code]").first()).toBeVisible()
})

test("workbench surfaces fail closed when the web bridge is unavailable", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  const bridgeResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/workbench-web/token" && response.request().method() === "POST",
  )
  await page.goto(`${dirPath(directory)}/session`)

  await page.getByRole("button", { name: "work mode" }).click()
  // Mode surfaces render in the Split/Editor layouts only; Chat shows the
  // conversation alone, as in the maquette.
  await page.getByRole("radio", { name: "Editor" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()
  // ADR-041: web runtimes have a bridge, but an unprotected server cannot mint leases.
  const denied = await bridgeResponse
  expect(denied.status()).toBe(404)
  expect(await denied.json()).toEqual({ error: "Workbench web bridge unavailable" })
  expect(denied.request().postDataJSON().action).toBe("open")
  // #274: a passwordless web bridge is the terminal `unsupported` state ADR-041
  // requires - its message stays, and no Reconnect that can never succeed.
  await expect(page.locator('[data-workbench-connection="unsupported"]')).toBeVisible()
  const detail = page.locator('[data-workbench-connection-detail="workbench-connection"]')
  await expect(detail).toHaveAttribute("role", "alert")
  await expect(detail).toContainText("UNIFIA_SERVER_PASSWORD")
  await expect(detail).toContainText("VITE_OPENCODE_SERVER_PASSWORD")
  await expect(detail).toContainText(/Reconnect alone is not enough|Reconnecter seul ne suffit pas/i)
  await expect(page.locator("[data-workbench-retry]")).toHaveCount(0)
  // Export lives in the Work header's overflow menu; with no artifact it is disabled.
  await page.getByRole("button", { name: /more actions|plus d'actions/i }).click()
  await expect(page.locator("[data-workbench-export]")).toHaveAttribute("aria-disabled", "true")
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "design mode" }).click()
  await expect(page.locator('[data-workbench-surface="design"]')).toBeVisible()
  // ADR-085: Design opens on the canvas studio; Spec is reached through the
  // studio's Atelier menu. `#workbench-design-spec` is only rendered while
  // the Spec tab is active.
  await page.locator("[data-design-workshop-menu]").click()
  await page.locator('[data-design-workshop-item="spec"]').click()
  await expect(page.locator("[data-design-workspace-active-kind='spec']")).toBeVisible()
  await page.locator("#workbench-design-spec").fill('{"id":"broken"}')
  await expect(page.locator("[data-workbench-diagnostics]")).toBeVisible()
  await expect(page.locator('[data-design-connection="unsupported"]')).toBeVisible()
  await page.locator("#workbench-design-spec").fill(VALID_SPEC)
  await expect(page.locator("[data-design-save-version]")).toBeDisabled()
  await expect(page.locator("[data-design-export-render]")).toBeDisabled()
  await expect(page.locator("[data-design-open-workshop]")).toBeDisabled()
})
