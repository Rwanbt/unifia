/* SPDX-License-Identifier: MIT */

// S7 + S9 + S11 surface test (test of surface, NOT visual parity claim).
// Verifies the v110 work / memory / automate / settings anchors from
// COMPONENT-MAP §4-§6 + §7 + §10 land once a project is open. Real backend.
// G2 visual parity vs the maquette is NOT claimed.

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"
import type { Page } from "@playwright/test"

// The Memory panel is reached through the Inspector pane: open the pane, land on
// its Inspector tab, then the Memory destination. The mode rail is collapsed into
// the Inspector frame (one shared pane, one tab at a time), so without this the
// `[data-parity="memory.panel"]` anchor is not in the DOM at all and the test
// failed with "element(s) not found". Same journey as the memory-* specs.
async function gotoMemorySurface(page: Page) {
  const toggle = page.locator('[data-v110="inspector-toggle"]')
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const inspectorTab = page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]')
  await inspectorTab.click()
  await expect(inspectorTab).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Memory", exact: true }).click()
}

test("memory anchor is mounted in the inspector content", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoMemorySurface(page)

  await expect(page.locator('[data-parity="memory.panel"]').first()).toBeAttached()
})

test("automate surface anchor carries the v110 marker", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  // `project.worktree` no longer exists on the fixture, so this test died on
  // `Buffer.from(undefined)` before navigating at all. `dirPath(project.directory)`
  // is the helper every other mode-surface spec uses (modes/mock-bridge-smoke,
  // v110/automate-responsive, v110/work-responsive, v110/work-team-panels).
  await page.goto(`${dirPath(project.directory)}/automate`)
  const surface = page.locator('[data-parity="automate.surface"]').first()
  await expect(surface).toBeVisible()
  await expect(surface).toHaveAttribute("data-v110", "automate-studio")
})

test("work surface anchors expose stable parity keys", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${dirPath(project.directory)}/work`)
  // The Work view element is `<div data-v110="work-view" data-parity="work.surface">`
  // (work-surface.tsx) and the `work.surface` key is pinned by a passing unit test
  // (session-workspace-layout.test.ts). The spec asserted `work.shell`, which no
  // element exposes, and its own reference for that anchor (`div.work-view`) is
  // this very element - so the divergence is in the key name, not the surface.
  //
  // parity-manifest/work.shell.json still declares `work.shell` and is left
  // untouched on purpose: `parity:manifest:check` cross-references the manifest
  // id against parity/state-policy.json and parity/style-profiles.json, so
  // renaming it would break that gate. The manifest/shipped-key divergence is
  // recorded in docs/audit/RC0-V110-PARITY-ANCHORS.md instead.
  await expect(page.locator('[data-parity="work.surface"]').first()).toBeVisible()
  await expect(page.locator('[data-parity="work.content"]').first()).toBeVisible()
})

test("settings dialog anchor is mounted when the settings dialog opens", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.keyboard.press("Control+Comma")
  await expect(page.locator('[data-parity="settings.dialog"]').first()).toBeVisible()
})
