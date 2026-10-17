/* SPDX-License-Identifier: MIT */

// #553 criterion 5 — the Automate studio's accessible structure, as a keyboard
// and screen-reader user meets it.
//
// Two defects were measured by axe (WCAG 2.1 A/AA tags) on the studio's default
// state:
//
//   * aria-required-children (critical) on [data-automate-debug-head]: the
//     debugger's collapse button sits INSIDE role="tablist", so the tab list
//     contains a child that is not a tab. This is the exact defect
//     design-workspace.tsx:72-77 already documents on the Design tab bar
//     ("a tablist may only contain tabs"): the bar keeps its own element, only
//     the tabs live in the tablist.
//
//   * aria-prohibited-attr (serious, 4 nodes) on the node port <circle>s: they
//     carried aria-label without a role, inside the role="img" canvas. That
//     subtree is presentational — automate-studio-canvas.tsx:29-34 says the
//     canvas exposes ONE image "so screen readers don't have to descend into the
//     SVG subtree", with a parallel sr-only <ol> listing the steps — so those
//     labels reached no one. They are named in that <ol> instead, which is the
//     accessible path and where a label is permitted.
//
// The same run certifies what the criterion actually asks for on this surface:
// the debug tabs are reachable by Tab, are activated by Enter/Space, and
// aria-selected follows the activation.

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"
import { expectNoNewViolations } from "../design/axe"

const DEFINITION_PATH = ".unifia/workflows/e2e-a11y-flow.json"
const DEFINITION = {
  id: "e2e-a11y-flow",
  version: 1,
  steps: [
    { id: "fetch", family: "io.http" },
    { id: "route", family: "control.if" },
    { id: "approve", family: "human.approval", requiresApproval: true },
  ],
}

const SURFACE = '[data-workbench-surface="automate"]'

test.describe("Automate studio — accessible structure and keyboard", () => {
  test.beforeEach(async ({ page, directory, gotoSession }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installWorkbenchMock(page, {
      workspaceId: "mock-workspace-1",
      grants: ["workflow.run"],
      files: [{ path: DEFINITION_PATH, kind: "file" }],
      fileContents: { [DEFINITION_PATH]: JSON.stringify(DEFINITION) },
    })
    await gotoSession()
    await page.goto(`${dirPath(directory)}/automate`)
    await expect(page.locator(SURFACE)).toBeVisible()
    await expect(page.locator("[data-automate-studio-debug]")).toBeVisible()
  })

  test("the debugger tab list contains tabs and nothing else", async ({ page }) => {
    const tablist = page.locator("[data-automate-debug-head] [role=tablist]")
    await expect(tablist).toHaveCount(1)

    // Every direct child of the tablist must be a tab: aria-required-children
    // has no other reading. The collapse button moved out of it.
    const children = await tablist.evaluate((node) =>
      [...node.children].map((child) => ({ role: child.getAttribute("role"), tag: child.tagName })),
    )
    expect(children.length, "the tab list is not empty").toBeGreaterThan(0)
    expect(children.filter((child) => child.role !== "tab"), "non-tab children of the tab list").toEqual([])

    // The collapse button still exists, still reaches the same state, and is no
    // longer a tab list child — it is the reason the rule fired.
    const toggle = page.locator("[data-automate-debug-toggle]")
    await expect(toggle).toHaveCount(1)
    expect(await toggle.evaluate((node) => !!node.closest("[role=tablist]"))).toBe(false)
  })

  test("the canvas describes its ports in the screen-reader list, not on the shapes", async ({ page }) => {
    // The canvas is one role="img" with a summary label; the port circles are
    // its decoration. An aria-label there is prohibited and reaches no one.
    const ports = page.locator("[data-automate-studio-port]")
    expect(await ports.count()).toBeGreaterThan(0)
    const labelled = await ports.evaluateAll((nodes) =>
      nodes.filter((node) => node.hasAttribute("aria-label")).map((node) => node.getAttribute("data-automate-studio-port")),
    )
    expect(labelled, "port circles carrying aria-label without a role").toEqual([])

    // The accessible path the file documents is still there, and it is where
    // the port names moved: the sr-only step list now names each step's ports.
    await expect(page.locator("[data-automate-studio-svg]")).toHaveAttribute("role", "img")
    await expect(page.locator("[data-automate-studio-svg]")).toHaveAttribute("aria-label", /\S/)

    const rows = page.locator("ol.sr-only li")
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText("Input port")
    await expect(rows.nth(0)).toContainText("Output port")
    await expect(rows.nth(1)).toContainText("True branch port")
    await expect(rows.nth(1)).toContainText("False branch port")
    await expect(rows.nth(2)).toContainText("Approval")
  })

  test("the debugger tabs are keyboard reachable and activated by the keyboard", async ({ page }) => {
    const tab = (name: string) => page.locator(`[data-automate-debug-tab="${name}"]`)
    await expect(tab("runs")).toHaveAttribute("aria-selected", "true")

    // Reach "logs" from the keyboard alone: two Tabs from the selected tab.
    await tab("runs").focus()
    await expect(tab("runs")).toBeFocused()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await expect(tab("logs")).toBeFocused()
    await expect(tab("logs")).toHaveAttribute("aria-selected", "false")

    await page.keyboard.press("Enter")
    await expect(tab("logs")).toHaveAttribute("aria-selected", "true")
    await expect(page.locator("[data-automate-logs], [data-automate-debug-empty]").first()).toBeVisible()

    // Space is the other activation key a button must answer.
    await tab("tests").focus()
    await page.keyboard.press("Space")
    await expect(tab("tests")).toHaveAttribute("aria-selected", "true")
  })

  test("the studio has no new axe violations", async ({ page }, testInfo) => {
    await expectNoNewViolations(page, testInfo, "Automate studio", SURFACE)
  })
})
