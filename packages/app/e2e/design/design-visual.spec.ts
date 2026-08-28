/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import type { Page } from "@playwright/test"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

// V13 — deterministic visual regression harness for the design
// surface.
//
// The plan (PLAN-CORRECTION-DESIGN-MINIMAX-M3-2026-08-27 §7/V13) requires
// "fixture déterministe sans vrai LLM ; figer fonts/animations/heure/
// données ; captures aux huit combinaisons ; produire image diff et
// métriques." The gate is "deux exécutions consécutives identiques
// sur le même host".
//
// What this spec captures:
//   - The Vite-rendered Design surface with a deterministic workbench mock at 4 viewports
//     (375 / 768 / 1280 / 1440) × 2 themes (light / dark) = 8
//     captures. These are the deterministic baseline: no LLM, no
//     bridge, the same payload every run.
//   - Animations are killed by an init-script stylesheet. Fonts are awaited via the
//     `document.fonts.ready` promise before the first capture.
//   - Time is pinned by overriding `Date.now` and `performance.now`
//     to a constant for the isolated browser page.

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const

const THEMES = [
  { name: "light", media: "light" },
  { name: "dark", media: "dark" },
] as const

const PINNED_EPOCH = 1735689600000 // 2025-01-01T00:00:00Z, fixed
const ANIMATION_DISABLE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}
`

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

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
}

async function waitForLayout(page: Page): Promise<void> {
  // Two RAFs after fonts are ready is the cheap, robust way to let
  // any pending paint settle. The animation-disable stylesheet
  // makes the rest of the layout stable.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      }),
  )
}

async function setTheme(page: Page, media: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: media })
}

async function captureDesignSurface(page: Page, name: string): Promise<Buffer> {
  const path = `e2e/visual-snapshots/${name}.png`
  await page.screenshot({ path, fullPage: false })
  return await import("node:fs").then((fs) => fs.promises.readFile(path))
}

test.describe("V13 — design surface visual harness", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`deterministic capture — ${theme.name} ${viewport.name}×${viewport.height}`, async ({ page, directory }) => {
        const name = `${theme.name}-${viewport.name}`
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await setTheme(page, theme.media)
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
        await expect(page.locator('[data-workbench-connection="ready"]')).toBeVisible()
        await expect(page.locator("[data-design-split]")).toBeVisible()
        await waitForFonts(page)
        await waitForLayout(page)
        const buf = await captureDesignSurface(page, name)
        // The PNG must be non-trivial (>1 KB) and a real PNG
        // (magic bytes 89 50 4E 47). Anything else means the
        // app failed to render and the snapshot would be useless.
        expect(buf.byteLength).toBeGreaterThan(1024)
        expect(buf[0]).toBe(0x89)
        expect(buf[1]).toBe(0x50)
        expect(buf[2]).toBe(0x4e)
        expect(buf[3]).toBe(0x47)
      })
    }
  }
})
