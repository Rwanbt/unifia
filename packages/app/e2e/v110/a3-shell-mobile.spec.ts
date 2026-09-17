/* SPDX-License-Identifier: MIT */

// RESPONSIVE-MATRIX rows tested here (previously "à tester"):
// - Rail: tablet-portrait collapse / phone-portrait hide (bottom nav only).
// - Sidebar: phone-portrait hidden, opened as an off-canvas drawer.
// - Chat composer: phone-portrait full width, clear of the bottom nav.
// - Chat message timeline: messages render compressed and the composer dock
//   stays docked at the bottom while the timeline scrolls.
//
// One shared session across the matrix, same reasoning as a3-responsive:
// a fresh gotoSession() per case is what caused the CI hang tracked at #71.

import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { overflow, track } from "./gate"

const RAIL = '[data-component="sidebar-rail"]'
const MOBILE_NAV = '[data-component="v110-mobile-nav"]'
const COMPOSER = '[data-component="prompt-input"]'
const DOCK = '[data-component="session-prompt-dock"]'
const WORKSPACE = '[data-v110="workspace"]'

test("shell chrome collapses to the mobile drawer and bottom nav across the matrix", async ({
  page,
  project,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await project.open()

  await withSession(project.sdk, "a3 shell mobile matrix", async (session) => {
    await project.sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [{ type: "text", text: "a3 shell mobile seed" }],
    })
    await expect
      .poll(
        async () =>
          (await project.sdk.session.messages({ sessionID: session.id, limit: 1 }).then((r) => r.data ?? []))
            .length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)

    await project.gotoSession(session.id)
    const t = track(page)
    // Two rails exist in the DOM (docked + off-canvas drawer): pin the
    // visible dock for desktop and the drawer container for the overlays.
    const rail = page.locator(`${RAIL}:visible`).first()
    const drawer = page.locator('[data-component="sidebar-nav-mobile"]')
    const seeded = () => page.getByText("a3 shell mobile seed").first()

    // Desktop: the rail is docked and there is no mobile chrome.
    await expect(rail).toBeVisible()
    await expect(page.locator(MOBILE_NAV)).toBeHidden()
    await expect(seeded()).toBeVisible()
    // The bottom nav must carry exactly the rail's modes (no hardcoded set).
    const modeCount = await rail.locator("[data-mode]").count()
    expect(modeCount).toBeGreaterThan(0)

    // Tablet portrait: rail collapsed into the closed off-canvas drawer,
    // no bottom nav, composer near full width.
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(300)
    await expect(page.locator(MOBILE_NAV)).toBeHidden()
    await expect
      .poll(async () => (await drawer.boundingBox())?.x ?? 0, { message: "tablet: rail drawer must be off-canvas" })
      .toBeLessThan(0)
    const tabletComposer = await page.locator(COMPOSER).boundingBox()
    if (!tabletComposer) throw new Error("tablet composer must be laid out")
    expect(tabletComposer.width).toBeGreaterThan(768 - 40)
    expect((await overflow(page)).dx, "tablet x-overflow").toBeLessThanOrEqual(6)

    // Phone portrait: bottom nav carries the four modes, the rail stays a
    // closed drawer until the topbar menu button opens it.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const nav = page.locator(MOBILE_NAV)
    await expect(nav).toBeVisible()
    await expect(nav.locator("[data-v110-tab]")).toHaveCount(modeCount)
    await expect
      .poll(async () => (await drawer.boundingBox())?.x ?? 0, { message: "phone: rail drawer must be off-canvas" })
      .toBeLessThan(0)
    const toggle = page.getByRole("button", { name: "Toggle menu", exact: true })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect
      .poll(async () => (await drawer.boundingBox())?.x ?? -1, { message: "phone: drawer must slide in" })
      .toBeGreaterThanOrEqual(0)
    await toggle.click()
    await expect
      .poll(async () => (await drawer.boundingBox())?.x ?? 0, { message: "phone: drawer must close again" })
      .toBeLessThan(0)

    // Composer: full width and clear of the bottom nav.
    const composer = await page.locator(COMPOSER).boundingBox()
    const dock = await page.locator(DOCK).boundingBox()
    const navBox = await nav.boundingBox()
    if (!composer || !dock || !navBox) throw new Error("phone composer/dock/nav must be laid out")
    expect(composer.width).toBeGreaterThan(390 - 40)
    expect(dock.y + dock.height).toBeLessThanOrEqual(navBox.y + 2)

    // Timeline: the seed message renders compressed (no overflow) and the
    // composer dock stays docked while the message area scrolls.
    await expect(seeded()).toBeVisible()
    const workspace = await page.locator(WORKSPACE).boundingBox()
    if (!workspace) throw new Error("workspace must be laid out")
    expect(dock.y + dock.height).toBeLessThanOrEqual(workspace.y + workspace.height + 2)
    const before = dock.y
    await page.locator('[data-component="session-workspace-main"]').evaluate((element) => element.scrollTo(0, 400))
    await page.waitForTimeout(150)
    const after = await page.locator(DOCK).boundingBox()
    expect(after?.y, "composer must stay docked while the timeline scrolls").toBe(before)
    expect((await overflow(page)).dx, "phone x-overflow").toBeLessThanOrEqual(6)

    t.stop()
    expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
    expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
  })
})
