/* SPDX-License-Identifier: MIT */

// Phase 12.2 — responsive contract for the Settings dialog, view by family.
//
// The mockup splits Settings into a side-by-side tab list on desktop and a
// drill-down list -> detail flow on narrow viewports. The runtime mirrors
// that split in dialog-settings.tsx (desktop Tabs) and
// settings-mobile-nav.tsx (drill-down), both fed by the canonical viewport
// authority (shell/v110-store useViewport -> tokens/viewport classify).
//
// This gate pins the split per family: desktop files show the tab list and
// never mount the mobile nav; overlay families mount the mobile nav, never
// the tab list, and the drill-down goes list -> detail -> back without
// x-overflow or console errors.

import { test, expect } from "../fixtures"
import { openSettings } from "../actions"
import { overflow, track } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900 },
  { name: "desktop-compact-1024x768", width: 1024, height: 768 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "phone-portrait-390x844", width: 390, height: 844 },
  { name: "compact-landscape-844x390", width: 844, height: 390 },
]

const OVERLAY_FAMILIES = new Set(["tablet-portrait-768x1024", "phone-portrait-390x844", "compact-landscape-844x390"])

test("settings dialog keeps the tabs/drill-down contract across viewport families", async ({ page, gotoSession }) => {
  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await gotoSession()

  const t = track(page)
  const dialog = await openSettings(page)

  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })
      // Crosses the isMobile() boundary in dialog-settings.tsx, plus the
      // 240ms panel transitions the dialog shares with the shell.
      await page.waitForTimeout(250)

      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)

      const mobile = dialog.locator('[data-slot="settings-mobile-nav"]')
      const generalTab = dialog.getByRole("tab", { name: "General", exact: true })

      if (OVERLAY_FAMILIES.has(c.name)) {
        await expect(mobile, c.name + ": mobile nav must mount on overlay families").toBeVisible()
        await expect(generalTab, c.name + ": desktop tab list must not render on overlay families").toHaveCount(0)

        const list = mobile.locator('[data-slot="settings-mobile-list"]')
        await expect(list, c.name + ": category list is the drill-down root").toBeVisible()

        await list.getByRole("button", { name: "General", exact: true }).click()
        const content = mobile.locator('[data-slot="settings-mobile-content"]')
        await expect(content, c.name + ": selecting a category opens its detail").toBeVisible()
        await expect(content.getByText(/^Language$/), c.name + ": detail renders the real surface").toBeVisible()

        await mobile.getByRole("button", { name: "Navigate back" }).click()
        await expect(list, c.name + ": back returns to the category list").toBeVisible()
      } else {
        await expect(mobile, c.name + ": mobile nav must not mount on desktop families").toHaveCount(0)
        await expect(generalTab, c.name + ": desktop tab list must render").toBeVisible()
        await expect(generalTab, c.name + ": general is the default tab").toHaveAttribute("aria-selected", "true")
      }
    })
  }

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  // @pierre/diffs' WorkerPoolManager logs console.error on a worker "error"
  // event ("Worker error: Event {worker: Worker, request_id, initialized:
  // false, langs}"). A failed worker boot is environment noise unrelated to
  // the layout contract — the app already swallows the pool's init rejection
  // (ui/src/pierre/worker.ts: `pool.initialize().catch(() => {})`) and the
  // session page creates the pool on open. Filtered here instead of in the
  // shared gate.ts track(), so the other gates keep failing on it.
  const noise = /Worker error: Event \{worker: Worker/
  const logs = t.logs.filter((line) => !noise.test(line))
  expect(logs, "console errors: " + logs.join(" | ")).toEqual([])
})
