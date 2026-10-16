/* SPDX-License-Identifier: MIT */

// #553 criterion 5 — the settings page the dialog opens on names its switches.
//
// `Switch` (@unifia/ui/switch) renders its label — a Kobalte `Label` — only
// when children are passed, so a self-closing <Switch … /> is a nameless form
// control: axe `label` (critical), and a screen reader announcing only
// "switch, on". Six of them sit on the page the dialog opens on, out of the
// twenty spread over the eight settings pages. The other fourteen are pinned by
// src/components/settings-switch-labels.test.ts, which reads the sources the
// fixture cannot render.
//
// Two heavier designs were measured and rejected:
//
//   * one axe run per rail page (seventeen in a single test) exhausted the
//     Playwright driver's heap — FATAL ERROR: JavaScript heap out of memory;
//   * sweeping the pages and reading names directly, with a single axe run at
//     the end, ended twice at the test timeout: a settings page renders through
//     a Suspense with no fallback and only the selected panel is mounted, so a
//     page that does not resolve leaves an empty panel and an unbounded wait.
//
// The contract is measured where the fixture actually renders controls, which
// is the page the dialog opens on, and the shared axe gate then answers for the
// rest of that page's rules.
//
// Scoped to the page panel, not the whole dialog: the rail is the subject of
// settings-a11y.spec.ts and its findings must not leak in here.

import { test, expect } from "../fixtures"
import { openSettings } from "../actions"
import { expectNoNewViolations } from "../design/axe"

const PANEL = '[data-parity="settings.dialog"] [data-slot="tabs-content"]'
const SWITCH = `${PANEL} [data-slot="switch-input"]`

test.describe("Settings — the opened page names its switches", () => {
  test("every switch on the page the dialog opens on has an accessible name", async ({ page, gotoSession }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSession()
    await openSettings(page)
    await expect(page.locator(`${PANEL} [data-slot="settings-page-head"]`)).toBeVisible()

    // The association axe computes, read directly: the control's own name
    // source, whatever mechanism supplies it.
    const names = await page.locator(SWITCH).evaluateAll((inputs) =>
      inputs.map((input) => {
        const control = input as HTMLInputElement
        const aria = control.getAttribute("aria-label")?.trim()
        if (aria) return aria
        const refs = (control.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
        const referenced = refs
          .map((id) => control.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim()
        if (referenced) return referenced
        return (control.labels?.[0]?.textContent ?? "").trim()
      }),
    )

    // Anti-vacuity: this page carries switches, so an empty list means the
    // fixture moved rather than that the page is clean.
    expect(names.length, "switches on the page the dialog opens on").toBeGreaterThan(0)
    testInfo.annotations.push({ type: "page", description: `${names.length} switch(es): ${names.join(" | ")}` })

    const unnamed = names.flatMap((name, index) => (name === "" ? [`switch ${index + 1}`] : []))
    expect(unnamed, "switches without an accessible name").toEqual([])

    await expectNoNewViolations(page, testInfo, "Settings opened page", PANEL)
  })
})
