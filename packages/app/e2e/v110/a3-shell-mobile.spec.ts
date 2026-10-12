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
import { overflow, track, trackFailingRequests, unexpectedRequests } from "./gate"

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
    const req = trackFailingRequests(page)
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

    // Tablet portrait: the rail stays docked. Measured at 768x1024 on
    // dev@e849922c98: rail 58px, mobile drawer not rendered at all (its
    // `shell:hidden` parent is display:none), bottom nav 0px, composer 638px.
    //
    // This block previously asserted a closed off-canvas drawer here, which is
    // the phone shape, and read it with `(await drawer.boundingBox())?.x ?? 0` —
    // so an element that is not rendered became the number 0 and the failure read
    // as a geometry defect instead of a wrong expectation. Same root cause as
    // the port-gate cluster fixed in #271: 768 is a docked-rail viewport.
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(300)
    await expect(page.locator(MOBILE_NAV)).toBeHidden()
    await expect(rail, "tablet keeps the docked rail").toBeVisible()
    await expect(drawer, "tablet has no phone drawer").toBeHidden()
    const tabletRail = (await rail.boundingBox())?.width ?? 0
    expect(tabletRail, "tablet rail width").toBeGreaterThan(0)
    // The composer fills the space beside the rail, whatever the chrome costs,
    // instead of being measured against a hardcoded near-full-width number that
    // a docked rail makes unreachable.
    const tabletComposer = await page.locator(COMPOSER).boundingBox()
    if (!tabletComposer) throw new Error("tablet composer must be laid out")
    expect(tabletComposer.x, "tablet composer starts after the rail").toBeGreaterThanOrEqual(tabletRail)
    expect(
      tabletComposer.x + tabletComposer.width,
      "tablet composer ends inside the viewport",
    ).toBeLessThanOrEqual(768)
    expect((await overflow(page)).dx, "tablet x-overflow").toBeLessThanOrEqual(6)

    // Phone portrait: bottom nav carries the modes plus Browser and Memory,
    // the rail stays a closed drawer until the topbar menu button opens it.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const nav = page.locator(MOBILE_NAV)
    await expect(nav).toBeVisible()
    await expect(nav.locator("[data-v110-tab]")).toHaveCount(modeCount + 2)
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

    // Composer: nested in its own chrome, and clear of the bottom nav.
    //
    // `expect(composer.width).toBeGreaterThan(390 - 40)` was never reachable.
    // Measured at 390x844 on dev@e849922c98, settled, after the drawer cycle:
    // dock 368 (x=11), composer 352 (x=19), prompt-input 332 (x=29) — about 58px
    // of chrome across the three, so the input can never reach 350. The numbers
    // also move with the drawer's transition (input 325.8 before, 332 after), so
    // a single hardcoded width also measured a mid-animation frame. What is
    // actually true, and worth asserting, is the nesting and the near-full-width
    // of the dock.
    const composer = await page.locator(COMPOSER).boundingBox()
    const dock = await page.locator(DOCK).boundingBox()
    const navBox = await nav.boundingBox()
    if (!composer || !dock || !navBox) throw new Error("phone composer/dock/nav must be laid out")
    expect(composer.x, "prompt-input sits inside the composer").toBeGreaterThanOrEqual(dock.x)
    expect(composer.x + composer.width, "prompt-input ends inside the composer").toBeLessThanOrEqual(
      dock.x + dock.width,
    )
    expect(dock.x, "dock starts inside the viewport").toBeGreaterThanOrEqual(0)
    expect(dock.x + dock.width, "dock ends inside the viewport").toBeLessThanOrEqual(390)
    expect(dock.width, "dock spans the phone width").toBeGreaterThan(390 * 0.9)
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
    // WHY a tolerance and not toBe: this asserted pixel-exact equality on a
    // layout position across a scroll, and measured 656.71875 against 656.8125 —
    // a 0.09px sub-pixel drift from the scroll itself, not movement. A dock that
    // actually un-docks moves by tens of pixels, so 1px still catches the defect
    // the assertion was written for.
    expect(after?.y, "composer must stay docked while the timeline scrolls").not.toBeUndefined()
    expect(
      Math.abs((after?.y ?? 0) - before),
      "composer must stay docked while the timeline scrolls",
    ).toBeLessThanOrEqual(1)
    expect((await overflow(page)).dx, "phone x-overflow").toBeLessThanOrEqual(6)

    t.stop()
    expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
    // Gate on the requests: Chromium's resource-error line carries no URL, so
    // only the recorded request can say which 404 this is. See BENIGN_HARNESS_404.
    expect(unexpectedRequests(req.bad), "failing requests: " + req.bad.join(" | ")).toEqual([])
    expect(
      t.logs.filter((entry) => !entry.includes("status of 404")),
      "console errors: " + t.logs.join(" | "),
    ).toEqual([])
  })
})
