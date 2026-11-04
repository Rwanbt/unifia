/* SPDX-License-Identifier: MIT */

import { existsSync } from "node:fs"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"
import { DESIGN_CANVAS_FILE, visualDocument } from "./design-content.fixture"
import { markE2E, seedServerUrl, VISUAL_BRANCH, VISUAL_PROJECT_ROOT, waitForSurface } from "./surface"

// V13 — deterministic visual regression for the Design surface.
//
// The plan (PLAN-CORRECTION-DESIGN-MINIMAX-M3-2026-08-27 §7/V13) asks for a
// deterministic fixture with no live LLM, frozen fonts/animations/time/data,
// captures at the eight combinations, an image diff, and "two consecutive runs
// identical on the same host".
//
// What this file used to do was capture eight PNGs and assert they began with
// the PNG magic bytes and weighed more than a kilobyte. Nothing was compared
// against anything: the surface could have rendered a blank page, a stack
// trace, or last month's layout, and every assertion would still have passed.
// It also could not run at all — the mock it imports carried an unescaped
// backtick that closed its own template literal, so the entire e2e suite
// failed to load. That is how a full-screen error boundary reached this branch
// unnoticed.
//
// Two gates now, deliberately different:
//
//   1. REGRESSION — toHaveScreenshot against a baseline committed under
//      __screenshots__/<platform>/. Playwright writes -expected, -actual and
//      -diff PNGs into e2e/test-results on failure, which CI already uploads.
//      Platform-scoped, because a baseline rendered on one OS does not
//      describe another; a platform with no committed baseline SKIPS with a
//      reason naming the command that creates one. Skipped is honest.
//      Generating the baseline from the very run being judged would not be:
//      it would pass by construction. That is also why the config sets
//      `updateSnapshots: "none"` — Playwright's default writes a missing
//      baseline and lets the run go green.
//
//   2. DETERMINISM — capture, reload, capture again, compare bytes. This one
//      runs everywhere, baseline or not, and it is the assertion that catches
//      an unpinned clock or a random identifier: those make the regression
//      gate flaky later, on somebody else's change.

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const

const THEMES = ["light", "dark"] as const

/** 2025-01-01T00:00:00Z. Any fixed instant works; it only has to not move. */
const PINNED_EPOCH = 1735689600000

const ANIMATION_DISABLE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}
`

const UPDATE_COMMAND = "bunx playwright test e2e/design/design-visual.spec.ts --update-snapshots"

/**
 * Pins the clock before any application code runs.
 *
 * Date.now() reaches the rendered output through relative timestamps, so a
 * capture taken a second later would differ from its baseline for a reason
 * that has nothing to do with the design.
 */
async function pinTime(page: Page): Promise<void> {
  await page.addInitScript(
    ({ epoch }: { epoch: number }) => {
      const OriginalDate = Date
      const FixedDate = function (this: unknown, ...args: ConstructorParameters<typeof Date>) {
        // @ts-expect-error - intentional Date override
        return new OriginalDate(...(args.length > 0 ? args : [epoch]))
      } as unknown as DateConstructor
      FixedDate.now = () => epoch
      FixedDate.parse = OriginalDate.parse
      FixedDate.UTC = OriginalDate.UTC
      globalThis.Date = FixedDate
      performance.now = () => 0
    },
    { epoch: PINNED_EPOCH },
  )
}

/** Two frames after the fonts resolve is enough for a page with no animation. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      }),
  )
}

async function openPinnedSurface(
  page: Page,
  directory: string,
  theme: (typeof THEMES)[number],
  viewport: { width: number; height: number },
  serverUrl: string,
): Promise<void> {
  await seedServerUrl(page, serverUrl)
  await page.setViewportSize(viewport)
  await page.emulateMedia({ colorScheme: theme })
  await markE2E(page)
  await pinTime(page)
  await page.addInitScript((css) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style")
      style.textContent = css
      document.head.append(style)
    })
  }, ANIMATION_DISABLE_CSS)
  await installWorkbenchMock(page)
  await page.goto(`${dirPath(directory)}/design`)
  await waitForSurface(page)
  // #729: The shipped Canvas reads its canonical SDK file, not the empty
  // Workbench artifact mock. Never certify an image of chrome alone.
  await expect(page.locator('[data-design-layer-row="rc1-729-shape"]')).toHaveCount(1)
  await expect(page.locator('[data-design-layer-row="rc1-729-label"]')).toContainText("RC1 729 Layer Text")
  await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()
  const fill = await page.locator("[data-design-canvas] canvas").first().evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Konva scene canvas not rendered")
    const context = element.getContext("2d")
    if (!context) throw new Error("Konva 2D context missing")
    const ratio = element.width / element.getBoundingClientRect().width
    return [...context.getImageData(Math.round(75 * ratio), Math.round(75 * ratio), 1, 1).data]
  })
  expect(fill, "the baseline must include the real orange Canvas rectangle").toEqual([232, 90, 50, 255])
  await expect(page.locator("body")).toContainText(VISUAL_PROJECT_ROOT)
  await expect(page.locator("body")).toContainText(VISUAL_BRANCH)
  // The top-level breadcrumb is part of the captured surface, not a separate
  // fixture. It must use the pinned identity rather than this clone's folder.
  await expect(page.locator('[data-v110="crumbs"]')).toContainText("unifia")
  // The chat scope badge is also visible in the full-page capture: without
  // this gate a local git branch leaks into otherwise pinned snapshots.
  await expect(page.locator('[data-v110="chat-scope"]')).toContainText(VISUAL_BRANCH)
  await settle(page)
}

test.describe("V13 — Design surface visual regression", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`matches the committed baseline — ${theme} ${viewport.name}x${viewport.height}`, async ({
        page,
        project,
        backend,
      }, testInfo) => {
        const name = `${theme}-${viewport.name}.png`
        const baseline = testInfo.snapshotPath(name)
        // A manual workflow_dispatch on Ubuntu is a CAPTURE run, never an
        // evaluation run. GitHub's existing Playwright artifact uploader
        // retains these images for owner review and a subsequent PR commit.
        // The independent pull_request run alone compares committed Linux PNGs.
        const capturing = process.platform === "linux" && process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
        // The skip is bypassed during an explicit `--update-snapshots` run:
        // that is the run whose whole purpose is to create the file this test
        // otherwise refuses to invent.
        const updating = testInfo.config.updateSnapshots !== "none"
        test.skip(
          !capturing && !updating && !existsSync(baseline),
          `no visual baseline committed for ${process.platform} at ${baseline}. Generate it on that platform with "${UPDATE_COMMAND}" and commit the result. This capture is NOT covered here.`,
        )
        await project.open({
          beforeGoto: async ({ sdk }) => {
            const saved = await sdk.file.write({ path: DESIGN_CANVAS_FILE, content: visualDocument("#e85a32") })
            expect(saved.data, "the visual fixture must persist in the active project").toBeDefined()
          },
        })
        await openPinnedSurface(page, project.directory, theme, viewport, backend.url)
        // The gate concerns the actual Design workspace. Screenshotting the
        // entire page also captures the independent chat composer, whose
        // animated "Ask anything..." glyph produced 940 unrelated differing
        // pixels in Linux CI (run 38935997122). Scope to the real Design
        // surface instead: no masks, no pixel tolerance, no synthetic DOM.
        const design = page.locator('[data-workbench-surface="design"]')
        await expect(design).toBeVisible()
        if (capturing) {
          const first = await design.screenshot({ animations: "disabled", caret: "hide" })
          await settle(page)
          const second = await design.screenshot({ animations: "disabled", caret: "hide" })
          expect(second.equals(first), "Ubuntu capture candidate must render identically twice").toBe(true)
          testInfo.annotations.push({ type: "capture-only", description: "NOT A REGRESSION GATE; review image, commit via PR, run a separate comparison" })
          await testInfo.attach(`linux-candidate-${name}`, { body: second, contentType: "image/png" })
          await testInfo.attach(`linux-candidate-${name}.json`, {
            body: JSON.stringify({
              os: process.platform,
              node: process.version,
              runner: process.env.RUNNER_IMAGE,
              sha: process.env.GITHUB_SHA,
              playwright: testInfo.project.name,
              viewport,
              theme,
              fixture: DESIGN_CANVAS_FILE,
            }),
            contentType: "application/json",
          })
          return
        }
        await expect(design).toHaveScreenshot(name, {
          // The baseline was produced by this browser on this platform, so one
          // differing pixel is a real change and not noise. Loosening this is
          // how a visual gate stops seeing anything.
          maxDiffPixels: 0,
          threshold: 0,
          animations: "disabled",
          caret: "hide",
        })
      })
    }
  }

  for (const theme of THEMES) {
    test(`renders identically across a reload — ${theme}`, async ({ page, project, backend }, testInfo) => {
      await project.open({
        beforeGoto: async ({ sdk }) => {
          const saved = await sdk.file.write({ path: DESIGN_CANVAS_FILE, content: visualDocument("#e85a32") })
          expect(saved.data, "reload fixture must persist in the active project").toBeDefined()
        },
      })
      await openPinnedSurface(page, project.directory, theme, { width: 1280, height: 800 }, backend.url)
      const first = await page.locator('[data-workbench-surface="design"]').screenshot({ animations: "disabled", caret: "hide" })
      await page.reload()
      await waitForSurface(page)
      await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()
      await expect(page.locator('[data-design-layer-row="rc1-729-shape"]')).toHaveCount(1)
      await settle(page)
      const second = await page.locator('[data-workbench-surface="design"]').screenshot({ animations: "disabled", caret: "hide" })
      if (!first.equals(second)) {
        // Attached rather than described: a byte count tells nobody which part
        // of the surface moved.
        await testInfo.attach(`${theme}-reload-first.png`, { body: first, contentType: "image/png" })
        await testInfo.attach(`${theme}-reload-second.png`, { body: second, contentType: "image/png" })
      }
      expect(
        first.equals(second),
        "the Design surface rendered differently on a second load with clock, animations and payload all pinned",
      ).toBe(true)
    })
  }
})
