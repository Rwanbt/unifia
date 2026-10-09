/* SPDX-License-Identifier: MIT */

// Phase 12.3 â€” responsive contract for the Code surface, family by family.
//
// RESPONSIVE-MATRIX ("Handset specifics") requires the terminal to be closed
// on first entry at every family: the panel is mounted but `aria-hidden`
// until the user opens it, and the session header's toggle stays reachable
// (the header deliberately shows it below 768px â€” see session-header.tsx).
//
// Like a4-code-chrome.spec.ts, this test does NOT open the terminal:
// ghostty-web PTY startup is a known CI-latency source (#71 diagnosis), so
// the open flow stays with the terminal suite. What is pinned per family:
//   - the code workspace is mounted and visible;
//   - the terminal toggle is visible and reports the closed state
//     (`aria-expanded=false`) while the panel reports `aria-hidden=true`;
//   - no x-overflow and no console/page errors.
//
// WHY `useEditorLayout` IS CALLED HERE. This spec was asserting the panel on the
// default Chat layout, where it cannot exist: `TerminalPanel` is imported and
// mounted by `session-editor-surface.tsx`, and that surface only renders in the
// Editor layout. Measured with a throwaway probe on all five families, the DOM
// had `[data-component="session-editor-surface"]` at count 0,
// `[data-v110="terminal-panel"]` at 0 and `[data-component="terminal"]` at 0,
// while `[aria-controls="terminal-panel"]` was present at 1. The assertion was
// therefore reporting "panel missing" for a panel that had never been mounted â€”
// the toggle's `aria-controls` points at `#terminal-panel`, which only exists
// inside the editor surface.
//
// `useEditorLayout` exists for exactly this and its own doc comment records the
// same measurement (`e2e/actions.ts:148`). This spec predates the helper and
// never adopted it. Switching once, before the loop, is enough: the layout
// persists across the resizes, which is what the family matrix is actually
// varying.

import { test, expect } from "../fixtures"
import { useEditorLayout } from "../actions"
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
  // The Code surface owns the terminal panel; the default Chat layout does not
  // mount it. One switch, before the loop, because the layout persists across
  // the resizes below.
  await useEditorLayout(page)

  const t = track(page)

  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.setViewportSize({ width: c.width, height: c.height })
      // The panel transitions across the overlay/desktop boundary. Waiting on the
      // condition rather than on a fixed 250ms: the assertion below is about the
      // panel being mounted and aria-hidden, so waiting for the panel to be
      // *there* is the thing being waited for. A sleep either wastes time when the
      // transition is instant or reports a missing panel when it is merely slow.
      await expect(page.locator('[data-v110="terminal-panel"]'), c.name + ": panel must be mounted").toHaveCount(1)

      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)

      await expect(
        page.locator('[data-component="session-workspace"]'),
        c.name + ": code workspace must be mounted",
      ).toBeVisible()

      // The toggle must be reachable, but WHERE it lives is a family property,
      // and the spec was asserting the topbar button everywhere. Measured on dev
      // with a throwaway probe, same harness, on the Editor layout:
      //
      //   family                 [data-v110=top-terminal]   [data-v110=code-terminal-fab]
      //   desktop-wide  1440x900   31x31 visible                0x0 display:none
      //   desktop-compact 1024x768  31x31 visible                0x0 display:none
      //   tablet-portrait 768x1024 32x31 visible                0x0 display:none
      //   phone-portrait   390x844  0x0  collapsed              44x44 display:grid
      //   compact-landscape 844x390 32x31 visible                0x0 display:none
      //
      // The topbar is folded away at phone-portrait and the editor carries a
      // floating action button instead â€” `session-editor-surface.tsx` comments it
      // as "phones have no topbar terminal button (the right slot is hidden
      // there); the reference puts a floating one on the editor". So the reachable
      // control at 390px is the FAB, and the contract is "reachable at this
      // family", not "in the topbar".
      const topbar = page.locator('[data-v110="top-terminal"]')
      const fab = page.locator('[data-v110="code-terminal-fab"]')
      const reachable = c.width < 600 ? fab : topbar
      await expect(reachable, c.name + ": terminal toggle must stay reachable").toBeVisible()
      await expect(topbar, c.name + ": terminal must be closed by default").toHaveAttribute(
        "aria-expanded",
        "false",
      )
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
