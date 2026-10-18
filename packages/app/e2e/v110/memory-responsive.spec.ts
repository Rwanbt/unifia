/* SPDX-License-Identifier: MIT */

// #553 (UI13/UI14) — responsive contract for the Memory surface, family by
// family.
//
// Memory had a11y and keyboard contracts but no viewport sweep, while
// v110-memory.css switches the triptych to a single-column layout at narrow
// widths; nothing pinned that switch. Same harness as the other responsive
// specs (../gate.ts overflow/track) and the same seeding practice as the
// memory note suite: one real note on the e2e directory plus the workbench
// mock listing, so the surface carries a note at every family instead of an
// empty state.
//
// Contract per family: the grid mounts, the page never overflows horizontally,
// the note stays reachable - whichever layout the width settles into, either
// the pane carries the note or the list offers its entry, and the spec opens
// the note when only the list is on screen - and no console error or pageerror
// appears during the sweep.

import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { overflow, track } from "./gate"

const CASES = [
  { name: "desktop-wide-1440x900", width: 1440, height: 900 },
  { name: "desktop-compact-1024x768", width: 1024, height: 768 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "phone-portrait-390x844", width: 390, height: 844 },
  { name: "compact-landscape-844x390", width: 844, height: 390 },
]

const NOTE = "responsive-note.md"
const NOTE_PATH = ".unifia/memory/responsive-note.md"

test("the memory surface keeps its note reachable across the five families", async ({ page, gotoSession, directory }) => {
  const dir = join(directory, ".unifia/memory")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, NOTE), "# Responsive\n\nviewport sweep body\n", "utf8")
  try {
    await installWorkbenchMock(page, { files: [{ path: NOTE_PATH, kind: "file" }] })
    await page.setViewportSize({ width: CASES[0].width, height: CASES[0].height })
    await gotoSession()
    const toggle = page.locator('[data-v110="inspector-toggle"]')
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    const inspectorTab = page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]')
    await inspectorTab.click()
    await expect(inspectorTab).toHaveAttribute("aria-selected", "true")
    await page.getByRole("button", { name: "Memory", exact: true }).click()
    const grid = page.locator('[data-v110="memory-grid"]')
    await expect(grid).toBeVisible()

    // Track after the last navigation: the deliberate page transition can
    // abort an in-flight provider refresh and logs a "Failed to fetch" the app
    // itself causes; the gate is about the sweep below, not that navigation.
    const t = track(page)

    for (const c of CASES) {
      await test.step(c.name, async () => {
        await page.setViewportSize({ width: c.width, height: c.height })

        await expect(grid, c.name + ": memory grid").toBeVisible()
        // Poll instead of reading once: v110 CSS transitions leave a transient
        // box while the layout reflows; the contract is persistent overflow.
        await expect
          .poll(async () => (await overflow(page)).dx, { message: c.name + ": global x-overflow exceeds 6px" })
          .toBeLessThanOrEqual(6)

        const pane = page.locator("[data-memory-note-pane]")
        const entry = page.locator(`[data-memory-note="${NOTE_PATH}"]`)
        // The note must be reachable at every family, but which control shows
        // it depends on the layout: the triptych (and the single-column layout
        // with an active note) renders the pane directly, while a list-first
        // state would need the entry. Poll for whichever settled first instead
        // of assuming a width mapping; clicking a half-transitioned list entry
        // would time out on its own animation.
        await expect
          .poll(
            async () => ((await pane.isVisible()) ? "pane" : (await entry.isVisible()) ? "list" : "none"),
            { message: c.name + ": note neither shown nor listed", timeout: 10_000 },
          )
          .not.toBe("none")
        if (!(await pane.isVisible())) {
          await entry.click()
          await expect(pane, c.name + ": note pane after opening its entry").toBeVisible()
        }
      })
    }

    t.stop()
    expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
    expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
  } finally {
    await rm(join(dir, NOTE), { force: true })
  }
})
