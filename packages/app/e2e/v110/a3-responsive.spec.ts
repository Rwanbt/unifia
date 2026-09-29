/* SPDX-License-Identifier: MIT */

// A3-04 responsive pass for the Jalon 1 additions (composer context-meter,
// InspectorFrame content). One shared session across the matrix, same
// reasoning as port-gate.spec.ts's WAVE05 loop: a fresh gotoSession() per
// case is what caused the CI hang tracked at #71, not anything specific to
// these viewports.

import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { overflow, track } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900 },
  { name: "desktop-compact-1024x768", width: 1024, height: 768 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "phone-portrait-390x844", width: 390, height: 844 },
  { name: "compact-landscape-844x390", width: 844, height: 390 },
]

test("composer context-meter and Inspector tabs render without overflow across the matrix", async ({
  page,
  project,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await project.open()

  await withSession(project.sdk, "a3 responsive matrix", async (session) => {
    // The context-meter (SessionContextUsage) only mounts once a session has
    // messages (gated on params.id being a real, message-bearing session) —
    // a fresh gotoSession() with no id lands on the messageless "new
    // session" screen, where it never renders at all.
    await project.sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [{ type: "text", text: "a3 responsive matrix seed" }],
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

    for (const c of CASES) {
      await page.setViewportSize({ width: c.width, height: c.height })
      // A real reflow tick: some of these transitions cross the mobile
      // overlay <-> desktop side-panel boundary (isMobile()), not just a
      // width/height number change.
      await page.waitForTimeout(200)

      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)

      // Context-meter: mounted unconditionally in the composer footer,
      // regardless of viewport (mobile hides the mode/model/permission
      // controls but not this one — see prompt-input.tsx).
      const meter = page.locator('button[aria-label*="context" i]').first()
      await expect(meter, c.name + ": context-meter must render in the composer footer").toBeVisible()

      await page.screenshot({ path: `e2e/test-results/a3-responsive-${c.name}.png` })
    }

    t.stop()
    expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
    expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
  })
})

async function walkInspectorTabs(
  page: import("@playwright/test").Page,
  gotoSession: () => Promise<void>,
  cases: typeof CASES,
): Promise<void> {
  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await gotoSession()

  for (const c of cases) {
    // Named steps: a failure inside the loop reports WHICH viewport family
    // broke, not just the tab name (learned from the 90 s CI timeout).
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })
      // A real reflow tick past the 240ms panel-width transition, not a
      // race workaround: the toggle button's own aria-expanded is
      // tab-specific (true only when open AND on "explorer"), so it can't
      // tell "closed" apart from "open on a different tab" (e.g. left on
      // "Execution" from the previous viewport in this loop) — checking
      // whether the tab strip itself is visible avoids that ambiguity, since
      // all three tabs render together whenever the panel is open at all.
      await page.waitForTimeout(400)

      const toggle = page.getByRole("button", { name: "Toggle file tree" }).first()
      await expect(toggle, c.name).toBeVisible()
      const explorerTab = page.getByRole("tab", { name: "Explorer", exact: true })
      if (!(await explorerTab.isVisible().catch(() => false))) {
        await toggle.click()
        await expect(explorerTab, c.name).toBeVisible()
      }

      for (const tabName of ["Explorer", "Inspector", "Execution"]) {
        const tab = page.getByRole("tab", { name: tabName, exact: true })
        await expect(tab, `${c.name}: ${tabName} tab must be reachable`).toBeVisible()
        await tab.click()
        await expect(tab, `${c.name}: ${tabName} tab must show as selected`).toHaveAttribute("aria-selected", "true")
        // "inspector" is the one wide tab (100% - chat column); switching to
        // or from it resizes the chat panel too (session.tsx's own
        // transition-[width] on the same 240ms clock). Settle before the
        // next click, same reasoning as the resize wait above.
        await page.waitForTimeout(300)
        const over = await overflow(page)
        expect(over.dx, `${c.name}/${tabName}: global x-overflow ${over.dx}px exceeds 6px`).toBeLessThanOrEqual(6)
      }
    })
  }
}

test("Inspector Explorer/Inspector/Execution tabs reachable across viewport modes", async ({ page, gotoSession }) => {
  await walkInspectorTabs(page, gotoSession, CASES)
})

// RESPONSIVE-MATRIX: the triptych keeps three panes on desktop families and
// collapses to one visible pane on the overlay families. Asserted on the real
// panel (the bridge-less web state still renders the layout contract) so a
// regression in v110-store classification fails here, not in production.
const OVERLAY_FAMILIES = new Set(["tablet-portrait-768x1024", "phone-portrait-390x844", "compact-landscape-844x390"])

test("memory pane keeps the triptych/single-pane contract across viewport modes", async ({ page, gotoSession }) => {
  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await gotoSession()

  const toggle = page.getByRole("button", { name: "Toggle file tree" }).first()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await page.getByRole("tab", { name: "Inspector", exact: true }).click()
  await page.getByRole("button", { name: "Memory", exact: true }).click()
  const panel = page.locator('[data-v110="memory-panel"]')
  await expect(panel).toBeVisible()

  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })
      // Crosses the overlay/desktop boundary (isMobile()) plus the 200ms
      // panel transitions, same reasoning as walkInspectorTabs.
      await page.waitForTimeout(250)
      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)
      await expect(panel, c.name + ": memory panel must stay mounted").toBeAttached()
      const grid = panel.locator("[data-memory-layout]")
      await expect(grid).toBeAttached()
      const layout = await grid.getAttribute("data-memory-layout")
      expect(layout, c.name + ": layout contract").toBe(OVERLAY_FAMILIES.has(c.name) ? "single" : "triptych")
      const visiblePanes = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-memory-vault], [data-memory-note-pane], [data-memory-links]")).filter((el) => {
          const box = el.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        }).length,
      )
      expect(visiblePanes, c.name + ": visible panes").toBe(OVERLAY_FAMILIES.has(c.name) ? 1 : 3)
    })
  }
})
