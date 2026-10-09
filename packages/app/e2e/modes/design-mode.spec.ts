/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"
import { openSpecTab } from "../design/surface"

// V14 — second and third scenarios of the design journey.
//
// The "bridge ready" scenario (open project → Design → mock bridge
// → send prompt → receive artifact → preview → comment → refine →
// version → export) needs a platform.workbench injection. That is
// out of scope for this card: V03 marked the workbench bridge as
// "not testable in the Vite harness without a platform mock", and
// the mock fixture itself is a non-trivial card of its own. V14
// delivers the two scenarios that ARE testable today:
//
//   - bridge indisponible / unsupported (V03 closure): the banner
//     shows the terminal state, the Reconnecter button is gone,
//     and a click on the "broken" spec raises a single diagnostic.
//
//   - responsive (V05+V06 closure): the same surface renders
//     without horizontal overflow at 375 / 768 / 1280 / 1440 px,
//     and the mobile surface switcher is the only path to the
//     workshop on small viewports.

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const

test("V14 — design mode in web is terminal and non-retryable (F-03 closure)", async ({ page, directory, slug }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/design`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/design(?:[/?#]|$)`))

  // Banner: "unsupported" phase, no Reconnecter button.
  // The Design surface names its own banner: data-workbench-connection is
  // rendered by Work, so this asserted an attribute this route never emits.
  await expect(page.locator('[data-design-connection="unsupported"]')).toBeVisible()
  await expect(page.locator("[data-design-retry]")).toHaveCount(0)

  // The spec editor is still usable. An invalid spec raises a
  // single diagnostic line, not the legacy "JSON invalide" double
  // error (F-05 closure).
  // Fichiers is the default tab; the editor only exists once Spec is
  // selected. This filled a locator that was never in the DOM.
  await openSpecTab(page)
  await page.locator("#workbench-design-spec").fill('{"id":"broken"}')
  await expect(page.locator("[data-workbench-diagnostics]")).toBeVisible()
  const diagnosticCount = await page.locator("[data-workbench-diagnostics] p").count()
  expect(diagnosticCount).toBe(1)
})

// Which pane the outer shell shows is the outer shell's concern, not Design
// mode's. `1171ccd387` ("unify Design mode's chat, delete the dead per-mode
// chat stack") removed `DesignSplit`'s own chat column, its own mobile
// switcher and the attributes this file used to assert — it was a second,
// nested implementation of exactly the concern `session.tsx` already owns for
// every mode. So the contract below is the shell's: a `layout-switch` radio
// group (aria-checked, not a tablist) over `Chat` / `Split` / `Editor`, and the
// panes it reveals. Measured on dev@c293142cfc, workers 1, retries 0:
//
//   375x812  radios Chat + Editor (no Split), overflow 0 at every step
//            Editor -> studio 351px, chat 0     Chat -> chat 353px, studio 0
//   1440x900 radios Chat + Split + Editor, overflow 0
//
// Which one is checked on arrival is persisted state and is deliberately not
// asserted; the reachable set and the switching are the contract.
const PANE = { studio: '[data-v110="design-studio"]', chat: '[data-v110="session-chat-surface"]' } as const

// Measured on dev@c293142cfc: the design surface first appears at ~4.6 s in this
// harness (0 surface attributes at 2.6 s, all of them at 4.65 s). Playwright's
// default expect timeout is 5 s, so an un-timed wait here is a coin flip that
// fails on whichever viewport happens to be slowest.
const SURFACE_READY = { timeout: 30_000 }

async function paneWidth(page: import("@playwright/test").Page, selector: string): Promise<number> {
  return page.evaluate((s) => document.querySelector<HTMLElement>(s)?.getBoundingClientRect().width ?? 0, selector)
}

function layoutRadio(page: import("@playwright/test").Page, name: string) {
  return page
    .getByRole("radio", { name, exact: true })
    .or(page.getByRole("button", { name, exact: true }))
    .first()
}

async function radioNames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-v110="layout-switch"] [role="radio"], [data-v110="layout-switch"] button'),
    )
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim())
      .filter(Boolean),
  )
}

test("V14 — design mode renders without horizontal overflow at every plan viewport", async ({ page, directory }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(`${dirPath(directory)}/design`)
    // The surface itself is the readiness signal. This used to wait on
    // `[data-design-split-kind]`, which `1171ccd387` deleted along with the
    // per-mode chat stack, so the wait could never resolve.
    await expect(page.locator('[data-workbench-surface="design"]')).toBeVisible(SURFACE_READY)
    await expect(page.locator("[data-design-canvas]")).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${viewport.name} must not overflow horizontally`).toBeLessThanOrEqual(1)
  }
})

test("V14 — mobile design mode exposes the shell's chat/atelier switcher (V06 closure)", async ({ page, directory }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`${dirPath(directory)}/design`)
  await expect(page.locator('[data-workbench-surface="design"]')).toBeVisible(SURFACE_READY)

  // A phone offers chat and the workshop and NOT Split: `layouts()` returns
  // ["chat", "main"] for portrait phones and tablets, so Split has no room.
  expect(await radioNames(page)).toEqual(["Chat", "Editor"])

  // Each radio is the keyboard path to its pane, and it really swaps them.
  const chat = layoutRadio(page, "Chat")
  const editor = layoutRadio(page, "Editor")
  await expect(chat).toBeVisible()
  await expect(editor).toBeVisible()

  await chat.click()
  await expect(chat).toHaveAttribute("aria-checked", "true")
  expect(await paneWidth(page, PANE.chat), "chat pane on mobile").toBeGreaterThan(0)
  expect(await paneWidth(page, PANE.studio), "studio hidden while chat is shown").toBe(0)

  await editor.click()
  await expect(editor).toHaveAttribute("aria-checked", "true")
  expect(await paneWidth(page, PANE.studio), "workshop pane on mobile").toBeGreaterThan(0)
  expect(await paneWidth(page, PANE.chat), "chat hidden while the workshop is shown").toBe(0)
})

test("V14 — desktop design mode keeps assistant and atelier side by side with a splitter", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${dirPath(directory)}/design`)
  await expect(page.locator('[data-workbench-surface="design"]')).toBeVisible(SURFACE_READY)

  // A desktop offers all three, so Split is the side-by-side state.
  expect(await radioNames(page)).toEqual(["Chat", "Split", "Editor"])

  const split = layoutRadio(page, "Split")
  await expect(split).toBeVisible()
  await split.click()
  await expect(split).toHaveAttribute("aria-checked", "true")

  const chat = await page.locator(PANE.chat).boundingBox()
  const studio = await page.locator(PANE.studio).boundingBox()
  if (!chat || !studio) throw new Error("split must show both panes")
  expect(chat.width, "the chat pane has width in Split").toBeGreaterThan(0)
  expect(studio.width, "the workshop pane has width in Split").toBeGreaterThan(0)
  // Side by side, not stacked: the chat sits to the left of the studio.
  expect(chat.x + chat.width, "the panes do not overlap").toBeLessThanOrEqual(studio.x)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, "split must not overflow horizontally").toBeLessThanOrEqual(1)
})
