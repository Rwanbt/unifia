/* SPDX-License-Identifier: MIT */

// #553 (UI13/UI14) — WCAG 2.1 A/AA gate for the two RC-1 surfaces that had no
// axe scan (Design, Automate and Settings already carry theirs). The gate uses
// the shared design/axe.ts harness, including its one recorded rule
// (color-contrast, the app-wide text-text-weak token decision, attached to
// each report rather than muted), and scopes each scan to its surface root so
// it measures the surface and not the shared chrome the Design gate already
// documents. A keyboard check rides along where the surface is a control
// list, because a scan that never presses anything only proves the tree at
// rest.

import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { expectNoNewViolations } from "../design/axe"

const HOME = '[data-v110="home"]'

test("the home surface has no new WCAG violations and its pills are keyboard-reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await expect(page.locator(HOME)).toBeVisible()

  // The six mode pills are the surface's controls; Tab must reach them and
  // their visible focus is asserted by the existing home spec — here the
  // claim is reachability plus the scan.
  const pills = page.locator('[data-parity="home.mode-pill"]')
  await expect(pills).toHaveCount(6)
  await pills.first().focus()
  await expect(pills.first()).toBeFocused()

  await expectNoNewViolations(page, testInfo, "Home surface", HOME)
})

test("the chat surface has no new WCAG violations", async ({ page, project }, testInfo) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  await withSession(project.sdk, "a11y chat gate", async (session) => {
    await project.sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [{ type: "text", text: "a11y chat gate seed" }],
    })
    await expect
      .poll(
        async () =>
          (await project.sdk.session.messages({ sessionID: session.id, limit: 1 }).then((r) => r.data ?? [])).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)
    await project.gotoSession(session.id)

    const chat = page.locator('[data-parity="session.chat"]')
    await expect(chat).toBeVisible()
    await expectNoNewViolations(page, testInfo, "Chat surface", '[data-parity="session.chat"]')
  })
})
