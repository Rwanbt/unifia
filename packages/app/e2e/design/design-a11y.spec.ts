/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { openDesignSurface, submitExport, markE2E } from "./surface"
import { expectNoNewViolations } from "./axe"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

// Accessibility gate for the Design surface â€” WCAG 2.1 AA, via axe.
//
// The states below are the ones the plan names: the surface itself, Automate
// present and absent, the approval modal, a completed export, and a failed
// one. They are scanned in a real browser because that is the only place the
// tree axe reads exists â€” the unit suite cannot even load design-surface.tsx
// (Solid's `use` is client-only), which is exactly how five defects shipped
// behind a modal with no reachable control.
//
// A dialog is the state most worth scanning and the least likely to be right:
// it needs a role, an accessible name, and controls a keyboard can reach.
// Scanning the whole document while it is open would drown the modal's own
// result in whatever the surface underneath already reports, so the modal is
// scanned on its own subtree.
//
// `expectNoNewViolations` fails on every rule except the ones axe.ts records
// as pre-existing, with the reason written down there.

/**
 * The Design surface root.
 *
 * The scans are scoped to it on purpose. A document-wide scan also reports the
 * application chrome â€” the workspace tab strip nests a close button inside a
 * role="tab", which axe flags as nested-interactive â€” and that is neither this
 * surface own defect nor something this gate can fix without redesigning
 * shared chrome. Reporting it here would force a blanket exemption and blind
 * the gate to the surface real regressions. It is recorded as a separate
 * finding instead.
 */
const DESIGN_SURFACE = '[data-workbench-surface="design"]'

const VIEWPORT = { width: 1440, height: 900 }

test.describe("Design surface â€” WCAG 2.1 AA", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
  })

  test("the surface has no violations without the workflow.run grant", async ({ page, directory, backend }, testInfo) => {
    await openDesignSurface(page, directory, { serverUrl: backend.url })
    // Owner decision 2026-09-21 (72916aebf9): the rail always shows Automate,
    // like the maquette; workflow.run is enforced on the action and by the
    // server, not by hiding the entry. This replaces DA-UI-01's hidden rail.
    await expect(page.locator('button[data-mode="automate"]').first()).toBeVisible()
    await expectNoNewViolations(page, testInfo, "Design surface, no workflow.run grant", DESIGN_SURFACE)
  })

  test("the surface has no violations with Automate in the rail", async ({ page, directory, backend }, testInfo) => {
    await openDesignSurface(page, directory, { grants: ["workflow.run"], serverUrl: backend.url })
    await expect(page.locator('button[data-mode="automate"]').first()).toBeVisible()
    await expectNoNewViolations(page, testInfo, "Design surface, Automate visible", DESIGN_SURFACE)
  })

  test("the approval modal has no violations", async ({ page, directory, backend }, testInfo) => {
    await openDesignSurface(page, directory, { exportOutcome: "approval-required", serverUrl: backend.url })
    await submitExport(page)
    const modal = page.locator('[data-design-approval-modal="approval-required"]')
    await expect(modal).toBeVisible()
    // The dialog contract that matters for a modal the user cannot dismiss any
    // other way: a role, a name, and reachable controls.
    await expect(modal).toHaveAttribute("role", "dialog")
    await expect(modal).toHaveAttribute("aria-labelledby", "design-approval-title")
    await expectNoNewViolations(page, testInfo, "approval modal", "[data-design-approval-modal]")
  })

  test("a completed export has no violations", async ({ page, directory, backend }, testInfo) => {
    await openDesignSurface(page, directory, { serverUrl: backend.url })
    await submitExport(page)
    await expect(page.locator('[data-design-export-result="exported"]')).toBeVisible()
    await expectNoNewViolations(page, testInfo, "export completed", DESIGN_SURFACE)
  })

  test("a failed export has no violations", async ({ page, directory, backend }, testInfo) => {
    await openDesignSurface(page, directory, { exportOutcome: "error", serverUrl: backend.url })
    await submitExport(page)
    await expect(page.locator('[data-design-export-result="error"]')).toBeVisible()
    await expectNoNewViolations(page, testInfo, "export failed", DESIGN_SURFACE)
  })

  test("the deferred studio controls stay focusable, announced, and effect-free", async ({ page, directory }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await markE2E(page)
    await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
    // The charted route for the studio itself: a6-responsive waits on the same
    // attribute after navigating here directly. The session-then-switch flow
    // lands on the conversation layout, where no studio control exists.
    await page.goto(`${dirPath(directory)}/design`)
    await expect(page.locator("[data-design-studio-layout]")).toBeVisible({ timeout: 30_000 })

    // Owner decision 2026-10-16 (option A): a deferred control keeps its place
    // in the tab order, announces unavailability without promising a delay,
    // and every activation path stays inert. The dock's pending entries
    // (`data-design-studio-pending`) and the panel's pending tools are the two
    // Design sites the decision names.
    const pending = page.locator("[data-design-studio-pending], [data-design-studio-tool][aria-disabled='true']")
    await expect(pending.first()).toBeVisible({ timeout: 30_000 })
    const count = await pending.count()
    expect(count).toBeGreaterThan(0)

    const activeToolBefore = await page.locator('[data-design-studio-dock] button[aria-pressed="true"]').getAttribute("data-design-tool")
    const writes: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`)
    })

    for (let index = 0; index < count; index++) {
      const control = pending.nth(index)
      await expect(control).toBeVisible()
      await expect(control).toHaveAttribute("aria-disabled", "true")
      await expect(control).toHaveJSProperty("disabled", false)
      await expect(control).toHaveJSProperty("tabIndex", 0)
      const name = (await control.getAttribute("aria-label")) ?? (await control.getAttribute("title")) ?? ""
      expect(name, `control ${index}: ${name}`).toMatch(/unavailable/i)
      expect(name, `control ${index}: ${name}`).not.toMatch(/soon|bientôt/i)
      await control.focus()
      await expect(control).toBeFocused()
      await page.keyboard.press("Enter")
      await page.keyboard.press("Space")
      await control.evaluate((element) => element.click())
    }

    // No activation path changed the selected tool, and none issued a write.
    await expect(page.locator('[data-design-studio-dock] button[aria-pressed="true"]')).toHaveAttribute("data-design-tool", activeToolBefore ?? "")
    expect(writes, "writes issued by inert deferred controls: " + writes.join(" | ")).toEqual([])
  })
})
