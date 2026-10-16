/* SPDX-License-Identifier: MIT */

// Motion kill-switch certification (UI13/UI14). INTERACTIONS.md:62 makes one
// contract out of `prefers-reduced-motion` and `html[data-ui-animations="off"]`:
// "aucun mouvement". Preferring one switch over the other silently is a defect,
// and so is stopping an animation that carried an element's visibility, so both
// are measured here in the real browser.
//
// The media state is emulated per page: the project-level `use.reducedMotion`
// option is declared in playwright.config.ts but does not reach the page in
// this harness (measured: the page still reports no-preference at load), the
// same reason design-visual.spec.ts emulates colorScheme per page.

import { test, expect } from "../fixtures"
import type { Page } from "@playwright/test"

type Tokens = Record<"fast" | "layout" | "split" | "micro" | "soft", string>

type Probe = { name: string; duration: string; iterations: string; height: number }

const STOPPED_TOKENS: Tokens = { fast: "0ms", layout: "0ms", split: "0ms", micro: "0ms", soft: "0ms" }

// The shell's own settings set `data-ui-animations`, and the sheet that owns
// `--v110-fast` is loaded by then; waiting for both keeps the reads below from
// racing the app's boot instead of sleeping for it.
const waitForShell = (page: Page) =>
  page.waitForFunction(() => {
    if (!document.documentElement.hasAttribute("data-ui-animations")) return false
    return getComputedStyle(document.documentElement).getPropertyValue("--v110-fast").trim().length > 0
  })

const readTokens = (page: Page): Promise<Tokens> =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      fast: root.getPropertyValue("--v110-fast").trim(),
      layout: root.getPropertyValue("--v110-layout").trim(),
      split: root.getPropertyValue("--v110-split").trim(),
      micro: root.getPropertyValue("--v110-micro").trim(),
      soft: root.getPropertyValue("--v110-soft").trim(),
    }
  })

// The STT waveform bar is the app's only looping keyframe animation that is
// defined by the shared design system (packages/ui styles/animations.css), so
// it witnesses the kill-switches for every looping animation: name, duration
// and iteration count come from CSS, the height from the bar itself.
const readWaveform = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const host = document.createElement("div")
    host.setAttribute("data-motion-probe", "")
    host.innerHTML =
      '<div style="display:flex;align-items:flex-end;gap:2px;height:16px">' +
      '<div data-probe="waveform" class="animate-stt-bar1" style="width:2px;background:currentColor"></div>' +
      "</div>"
    document.body.appendChild(host)
    const bar = host.querySelector('[data-probe="waveform"]') as HTMLElement
    const style = getComputedStyle(bar)
    const probe = {
      name: style.animationName,
      duration: style.animationDuration,
      iterations: style.animationIterationCount,
      height: Math.round(bar.getBoundingClientRect().height),
    }
    host.remove()
    return probe
  })

test("motion is allowed by default: the tokens keep their declared values and the waveform runs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await waitForShell(page)

  expect(await readTokens(page)).toEqual({
    fast: "150ms",
    layout: "650ms",
    split: "680ms",
    micro: "150ms",
    soft: "220ms",
  })

  const waveform = await readWaveform(page)
  expect(waveform.name).toBe("stt-wave")
  expect(waveform.iterations).toBe("infinite")
  expect(waveform.height).toBeGreaterThan(0)
})

test("prefers-reduced-motion stops the loops instead of accelerating them", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await waitForShell(page)

  expect(await readTokens(page)).toEqual(STOPPED_TOKENS)

  // A looping animation left at a 0.01ms duration is not stopped: it runs
  // faster than the eye can follow. "No movement" means the loop is gone.
  const waveform = await readWaveform(page)
  expect(waveform.name).toBe("none")
  expect(waveform.iterations).toBe("1")

  // Stopping the wave must not take the recording indicator with it.
  expect(waveform.height).toBeGreaterThan(0)
})

test("html[data-ui-animations=off] declares the same motion as reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await waitForShell(page)

  const reduced = await readWaveform(page)

  await page.evaluate(() => document.documentElement.setAttribute("data-ui-animations", "off"))
  const off = await readWaveform(page)

  expect(off).toEqual(reduced)
  expect(off.name).toBe("none")
  expect(off.height).toBeGreaterThan(0)
})
