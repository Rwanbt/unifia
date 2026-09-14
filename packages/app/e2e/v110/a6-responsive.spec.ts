/* SPDX-License-Identifier: MIT */

// Phase 12.4 — responsive contract for the Design split, family by family.
//
// The design workbench resolves its layout from the canonical v110 viewport
// classification (pages/workbench/design-responsive.ts -> tokens/viewport):
//
//   desktop-wide                                -> kind "desktop" (split + handle)
//   desktop-compact / compact-landscape         -> kind "tablet"  (two surfaces, no handle)
//   tablet-portrait / phone-portrait            -> kind "mobile"  (one surface + switcher)
//
// The contract per family: the split kind matches the classification, the
// switcher exists exactly on the mobile families (it is the only path to the
// workshop there), and no x-overflow or console/page error appears. This
// extends modes/design-mode.spec.ts (V14: 375/768/1280/1440 overflow + the
// 375 switcher behaviour) to the five certified families, including
// compact-landscape, which no design spec covered.

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"
import { overflow, track } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900, kind: "desktop", switcher: false },
  { name: "desktop-compact-1024x768", width: 1024, height: 768, kind: "tablet", switcher: false },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024, kind: "mobile", switcher: true },
  { name: "phone-portrait-390x844", width: 390, height: 844, kind: "mobile", switcher: true },
  { name: "compact-landscape-844x390", width: 844, height: 390, kind: "tablet", switcher: false },
]

test("design split follows the v110 family classification across viewports", async ({ page, directory }) => {
  const t = track(page)

  for (const c of CASES) {
    await test.step(c.name, async () => {
      // The split reads the viewport at render time, so size first, then load.
      await page.setViewportSize({ width: c.width, height: c.height })
      await page.goto(`${dirPath(directory)}/design`)

      await expect(page.locator("[data-design-split-kind]"), c.name + ": split must mount").toBeVisible()
      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)

      await expect(
        page.locator(`[data-design-split-kind="${c.kind}"]`),
        c.name + ": split kind must follow the v110 classification",
      ).toBeVisible()

      const switcher = page.locator("[data-design-surface-switcher]")
      if (c.switcher) {
        await expect(switcher, c.name + ": mobile families need the surface switcher").toBeVisible()
        await expect(switcher.getByRole("tab", { name: "Assistant" })).toBeVisible()
        await expect(switcher.getByRole("tab", { name: "Workshop" })).toBeVisible()
        await expect(page.locator("[data-design-split-assistant]")).toBeVisible()
      } else {
        await expect(switcher, c.name + ": non-mobile families must not show the switcher").toHaveCount(0)
        await expect(page.locator("[data-design-split-chat]"), c.name + ": chat surface").toBeVisible()
        await expect(page.locator("[data-design-split-workspace]"), c.name + ": workspace surface").toBeVisible()
      }
    })
  }

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
