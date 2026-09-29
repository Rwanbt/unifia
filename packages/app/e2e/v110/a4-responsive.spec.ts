/* SPDX-License-Identifier: MIT */

// Phase 12.3 — responsive contract for the Code surface, family by family.
//
// RESPONSIVE-MATRIX ("Handset specifics") requires the terminal to be closed
// on first entry at every family: the panel is mounted but `aria-hidden`
// until the user opens it, and the session header's toggle stays reachable
// (the header deliberately shows it below 768px — see session-header.tsx).
//
// Like a4-code-chrome.spec.ts, this test does NOT open the terminal:
// ghostty-web PTY startup is a known CI-latency source (#71 diagnosis), so
// the open flow stays with the terminal suite. What is pinned per family:
//   - the code workspace is mounted and visible;
//   - the terminal toggle is visible and reports the closed state
//     (`aria-expanded=false`) while the panel reports `aria-hidden=true`;
//   - no x-overflow and no console/page errors.

import { test, expect } from "../fixtures"
import { overflow, track } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900 },
  { name: "desktop-compact-1024x768", width: 1024, height: 768 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "phone-portrait-390x844", width: 390, height: 844 },
  { name: "compact-landscape-844x390", width: 844, height: 390 },
]

test("code surface keeps the terminal-closed default and reachable toggle across families", async ({
  page,
  gotoSession,
}) => {
  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await gotoSession()

  const t = track(page)

  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })
      // Crosses the overlay/desktop boundary and the panel transitions.
      await page.waitForTimeout(250)

      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)

      await expect(
        page.locator('[data-component="session-workspace"]'),
        c.name + ": code workspace must be mounted",
      ).toBeVisible()

      const toggle = page.locator('[aria-controls="terminal-panel"]')
      await expect(toggle, c.name + ": terminal toggle must stay reachable").toBeVisible()
      await expect(toggle, c.name + ": terminal must be closed by default").toHaveAttribute("aria-expanded", "false")
      await expect(
        page.locator('[data-v110="terminal-panel"]'),
        c.name + ": closed panel must be aria-hidden",
      ).toHaveAttribute("aria-hidden", "true")
    })
  }

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
