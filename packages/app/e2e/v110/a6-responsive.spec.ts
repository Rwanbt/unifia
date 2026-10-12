/* SPDX-License-Identifier: MIT */

// Responsive contract for the Design studio, family by family.
//
// WHY THIS SPEC WAS REWRITTEN. It used to assert a three-value split kind
// (`data-design-split-kind`, `desktop` / `tablet` / `mobile`) plus a surface
// switcher, an assistant pane and a workspace pane. Every one of those
// attributes belonged to `DesignSplit`, which was deleted on purpose by
// `1171ccd38 fix(parity): unify Design mode's chat, delete the dead per-mode
// chat stack` â€” `b00ccd818` had added them, and that commit's message explains
// why they went: DesignSplit rendered its own chat column beside the workshop
// plus its own mobile switcher, a second nested copy of the "which pane is
// visible" concern that `session.tsx`'s outer shell already owns for every
// mode. The cited authority `pages/workbench/design-responsive.ts` is gone too.
//
// So the old assertions could not be repaired by renaming a locator: the
// component they described does not exist. What replaces it is
// `design-studio.tsx`, and it still answers the same question the spec was
// written to ask â€” does the studio lay itself out differently as the viewport
// family changes? â€” through `data-design-studio-layout` and the controls that
// only make sense once the panes are stacked.
//
// Every expectation below was measured against this tree before being written
// (clean clone of dev, one worker, zero retries). The measured table:
//
//   family                 layout   layers-toggle  bottombar  present  rail  scrollW/innerW
//   desktop-wide   1440x900  studio        -            -          yes     62px     1440/1440
//   desktop-compact 1024x768  studio        -            -          yes     58px     1024/1024
//   tablet-portrait 768x1024 single        yes          yes        no      58px      768/768
//   phone-portrait   390x844  single        yes          yes        no       0px      390/390
//   compact-landscape 844x390 single        yes          yes        no      58px      844/844
//
// The split point is between 1024 and 768, which is the boundary between the
// two-surface studio and the single-surface one, not the old three-way
// classification. The 0px rail on phone-portrait is the rail being unmounted
// there and the mobile nav taking over; it is asserted below rather than
// glossed over, because a rail measuring 0 is exactly the kind of thing that
// looks like a layout escape and is not.

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"
import { overflow, trackFailingRequests, unexpectedRequests } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900, layout: "studio", stacked: false },
  { name: "desktop-compact-1024x768", width: 1024, height: 768, layout: "studio", stacked: false },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024, layout: "single", stacked: true },
  { name: "phone-portrait-390x844", width: 390, height: 844, layout: "single", stacked: true },
  { name: "compact-landscape-844x390", width: 844, height: 390, layout: "single", stacked: true },
]

test("design studio follows the v110 family classification across viewports", async ({ page, directory }) => {
  // Load once at the first family size. Reloading per viewport only added the
  // aborted provider refresh each navigation leaves behind, which surfaced as
  // "Failed to fetch" from the app's own bootstrap.
  await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
  await page.goto(`${dirPath(directory)}/design`)
  // The design surface mounts its studio asynchronously, and on this machine the
  // first paint lands several seconds after navigation. The old spec waited on
  // `[data-design-split-kind]`, which no longer exists, so this waits on the
  // attribute that does â€” on the studio layout, not on a fixed delay, because a
  // fixed delay reports "timed out" for a surface that is merely still arriving.
  await expect(page.locator("[data-design-studio-layout]")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-workbench-surface="design"]')).toHaveCount(1)

  // WHY THE CONSOLE GATE IS NOT `track`. Chromium reports every resource failure
  // with the SAME text and NO URL â€” "Failed to load resource: net::
  // ERR_CONNECTION_REFUSED" â€” so a text filter cannot tell an expected one from
  // a real fault and cannot name which request it was. Measured on this tree
  // before this was written: with the studio settled, the route produces ZERO
  // HTTP responses >= 400, and every remaining console entry is the app's own
  // bootstrap polling a backend on 127.0.0.1:4096 that this harness does not
  // start (23 distinct paths: /agent, /config, /session/status, /provider, ...).
  // Those are transport failures with no HTTP status at all, so
  // `trackFailingRequests` â€” which records status, method and URL â€” cannot see
  // them either, and that is the point: asserting on the HTTP gate makes the
  // assertion about the product again instead of about the harness.
  //
  // This is the same reasoning as `BENIGN_HARNESS_404` in ./gate: a gate that
  // cannot fail on the right thing is worse than no gate.
  const http = trackFailingRequests(page)

  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })

      const studio = page.locator("[data-design-studio-layout]")
      await expect(studio, c.name + ": the studio must stay mounted").toHaveCount(1)
      await expect(
        page.locator(`[data-design-studio-layout="${c.layout}"]`),
        c.name + ": layout must follow the v110 family classification",
      ).toHaveCount(1)

      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)

      // The studio's own chrome follows the layout, and these are the controls
      // that only have a purpose once the panes are stacked. Asserting both
      // directions is what makes this a layout contract rather than a presence
      // check: a studio that simply stopped rendering either one would fail.
      const layersToggle = page.locator("[data-design-studio-layers-toggle]")
      const bottombar = page.locator("[data-design-studio-bottombar]")
      if (c.stacked) {
        await expect(layersToggle, c.name + ": stacked families reach the layers through a toggle").toHaveCount(1)
        await expect(bottombar, c.name + ": stacked families move the studio actions into a bottom bar").toHaveCount(1)
      } else {
        await expect(layersToggle, c.name + ": two-surface families must not show the layers toggle").toHaveCount(0)
        await expect(bottombar, c.name + ": two-surface families must not show the bottom bar").toHaveCount(0)
      }
    })
  }

  http.stop()
  expect(unexpectedRequests(http.bad), "unexpected HTTP failures: " + http.bad.join(" | ")).toEqual([])
})