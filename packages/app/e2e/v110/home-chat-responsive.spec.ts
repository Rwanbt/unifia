/* SPDX-License-Identifier: MIT */

// #553 (UI13/UI14) — responsive contract for the Home and Chat surfaces,
// family by family. Every other RC-1 surface carries a viewport sweep
// (work/automate/settings responsive specs, design `a6`, code `a4`, memory
// its own); Home and Chat were only exercised at 1440x900, so nothing pinned
// their behaviour at the representative widths.
//
// Same shared harness and scoping discipline as the other sweeps
// (../gate.ts overflow/track): each case resizes one mounted surface and
// asserts the surface stays on screen, its primary control stays reachable,
// the page never overflows horizontally, and no console error or pageerror
// appears during the sweep. Chat is seeded with one message so the thread is
// a real conversation rather than an empty shell, the same practice as the
// Home/Chat a11y gate.

import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { promptSelector } from "../selectors"
import { overflow, track } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900 },
  { name: "desktop-compact-1024x768", width: 1024, height: 768 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "phone-portrait-390x844", width: 390, height: 844 },
  { name: "compact-landscape-844x390", width: 844, height: 390 },
]

const HOME = '[data-v110="home"]'

test("the home surface keeps its mode pills reachable across the five families", async ({ page }) => {
  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await page.goto("/")
  const home = page.locator(HOME)
  await expect(home).toBeVisible()
  const pills = page.locator('[data-parity="home.mode-pill"]')
  await expect(pills).toHaveCount(6)

  // Settle before tracking: the home boot fires one provider refresh whose
  // cross-origin leg the dev-server harness reports as a CORS console error
  // (the same class of artifact the Work sweep documents when leaving the
  // session page). data-state leaves "loading" once the app settled, so the
  // gate below covers the steady state and the resize loop - not the boot.
  await expect(home).not.toHaveAttribute("data-state", "loading")

  const t = track(page)
  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })
      await expect(home, c.name + ": home surface").toBeVisible()
      // The mode row is the surface's controls. At rest no pill is pressed, so
      // the contract is reachability: the row and its first pill stay on
      // screen at every family, and the wide families must show the whole row
      // rather than clipping it.
      await expect(page.locator('[data-v110="home-modes-row"]'), c.name + ": modes row").toBeVisible()
      await expect(pills.first(), c.name + ": first pill").toBeVisible()
      if (c.width >= 1024) {
        await expect(pills.nth(5), c.name + ": last pill on wide families").toBeVisible()
      }
      await expect
        .poll(async () => (await overflow(page)).dx, { message: c.name + ": global x-overflow exceeds 6px" })
        .toBeLessThanOrEqual(6)
    })
  }
  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})

test("the chat surface keeps its composer reachable across the five families", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })

  await withSession(project.sdk, "responsive chat gate", async (session) => {
    await project.sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [{ type: "text", text: "responsive gate seed" }],
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

    const t = track(page)
    for (const c of CASES) {
      await test.step(c.name, async () => {
        await page.setViewportSize({ width: c.width, height: c.height })
        await expect(chat, c.name + ": chat surface").toBeVisible()
        // The composer is the surface's primary control: a conversation you
        // cannot answer at a given width is not reachable, whatever it looks
        // like. It must stay visible at every family.
        await expect(page.locator(promptSelector), c.name + ": composer").toBeVisible()
        await expect
          .poll(async () => (await overflow(page)).dx, { message: c.name + ": global x-overflow exceeds 6px" })
          .toBeLessThanOrEqual(6)
      })
    }
    t.stop()
    expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
    expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
  })
})
