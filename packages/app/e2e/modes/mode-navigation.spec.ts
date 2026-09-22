/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

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

test("workbench surfaces fail closed before a native bridge is available", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)

  await page.getByRole("button", { name: "work mode" }).click()
  // Mode surfaces render in the Split/Editor layouts only; Chat shows the
  // conversation alone, as in the maquette.
  await page.getByRole("radio", { name: "Editor" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()
  // V03 — the data attribute is now driven by the WorkbenchUiPhase
  // state machine, not the legacy phase signal. In the Vite harness
  // there is no native bridge, so the UI phase is "unsupported"
  // (terminal). The banner must NOT show the "Reconnecter" button
  // — clicking it would re-reject in a loop (F-03). The diagnostic
  // message is the inlined "Disponible dans l'application desktop"
  // (FR) or its English equivalent, not the old "failed" copy.
  await expect(page.locator('[data-workbench-connection="unsupported"]')).toBeVisible()
  await expect(page.locator("[data-workbench-retry]")).toHaveCount(0)
  await expect(page.getByText(/desktop application|application desktop/i).first()).toBeVisible()
  // Export lives in the Work header's overflow menu; with no artifact it is disabled.
  await page.getByRole("button", { name: /more actions|plus d'actions/i }).click()
  await expect(page.locator("[data-workbench-export]")).toHaveAttribute("aria-disabled", "true")
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "design mode" }).click()
  await expect(page.locator('[data-workbench-surface="design"]')).toBeVisible()
  // `seedDesignTabState` ouvre "Spec" puis "Fichiers", et `openTab` active
  // l'onglet qu'il vient d'ajouter : la surface Design atterrit donc sur
  // Fichiers, pas sur Spec. L'éditeur `#workbench-design-spec` n'est pas rendu
  // tant que l'onglet Spec n'est pas actif, et `fill()` expirait au bout de
  // 60 s sur un élément absent. Le test supposait un onglet par défaut qui a
  // changé sans que l'assertion suive.
  await page.locator('[data-design-workspace-tab="spec"]').click()
  await expect(page.locator("[data-design-workspace-active-kind='spec']")).toBeVisible()
  await page.locator("#workbench-design-spec").fill('{"id":"broken"}')
  await expect(page.locator("[data-workbench-diagnostics]")).toBeVisible()
})
