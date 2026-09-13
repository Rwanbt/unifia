/* SPDX-License-Identifier: MIT */

/**
 * MiniMax M3 — Phase 2 test harness helpers.
 *
 * Extends the existing actions.ts / fixtures.ts with viewport,
 * mode-switch, overflow and focus assertions needed for the
 * M3 acceptance matrix. Every helper is deterministic, scoped to
 * one viewport, and returns a primitive (boolean/number/string) so
 * callers can compose them into Playwright expect() assertions
 * without coupling to internal state shapes.
 *
 * Anti-regression rule honored: NO helper loops over multiple
 * viewports in the same page (the Vague-0 cartesian-matrix hang).
 * Multi-viewport coverage lives in separate spec files with their
 * own page fixture.
 */

import type { Page } from "@playwright/test"
import { toggleSidebar } from "./actions"

export type ShellMode = "code" | "work" | "design" | "automate"

/** The six viewport families mandated by VISUAL-GATES + RESPONSIVE-MATRIX. */
export const VIEWPORT_FAMILIES = {
  desktopLarge: { width: 1440, height: 900 },
  desktopCompact: { width: 1280, height: 800 },
  tabletLandscape: { width: 1024, height: 768 },
  tabletPortrait: { width: 768, height: 1024 },
  mobileLandscape: { width: 844, height: 390 },
  mobilePortrait: { width: 390, height: 844 },
} as const

export type ViewportFamily = keyof typeof VIEWPORT_FAMILIES

/**
 * Switch to one of the six viewport families. The Playwright page is
 * mutated in place; no extra context or goto is issued so the running
 * session keeps its state (scroll position, selected tab, etc.) —
 * critical for catching layout regressions vs re-launching the page.
 */
export async function setViewportFamily(page: Page, family: ViewportFamily): Promise<void> {
  const size = VIEWPORT_FAMILIES[family]
  await page.setViewportSize(size)
}

/** True when the rail exposes an enabled trigger for this mode. Automate is grant-gated (ADR-1041), so callers must skip disabled triggers instead of clicking them. */
export async function shellModeEnabled(page: Page, mode: ShellMode): Promise<boolean> {
  const trigger = page.locator(`[data-component="sidebar-rail"] [data-mode="${mode}"]`).first()
  if ((await trigger.count()) === 0) return false
  return trigger.isEnabled()
}

/**
 * Pick a shell mode by clicking the corresponding rail trigger.
 * Asserts the mode change took effect by reading the data attribute
 * on the workspace main element. Returns the resolved mode.
 */
export async function pickShellMode(page: Page, target: ShellMode): Promise<ShellMode> {
  // Rail buttons carry data-mode (sidebar-shell.tsx); the workspace main
  // carries data-workbench-mode (layout.tsx). These are the markers the
  // A8-02 strict gate reads, verified against HEAD on 2026-09-13.
  // The rail renders a top twin and a bottom twin per mode (INTERACTIONS
  // "bottom-twin 31px"), so the selector matches two buttons by design.
  const trigger = page.locator(`[data-component="sidebar-rail"] [data-mode="${target}"]`).first()
  await trigger.click()
  const workspace = page.locator('[data-v110="workspace"]')
  await workspace.waitFor({ state: "visible" })
  // Mode switching is a reactive navigation (ensureModeLoaded + workbench
  // mount), not a synchronous class flip: wait on the observable state
  // instead of reading once.
  await page.waitForFunction(
    (mode) => document.querySelector('[data-v110="workspace"]')?.getAttribute("data-workbench-mode") === mode,
    target,
    { timeout: 15_000 },
  )
  const resolved = (await workspace.getAttribute("data-workbench-mode")) as ShellMode | null
  if (resolved !== target) {
    throw new Error(`pickShellMode(${target}) resolved to ${resolved}; rail trigger likely missing or click intercepted`)
  }
  return resolved
}

/** Toggle the persistent sidebar; returns whether the sidebar is now opened. */
export async function toggleWorkspaceSidebar(page: Page): Promise<boolean> {
  await toggleSidebar(page)
  return page.locator('[data-v110="resize-context-wrapper"]').isVisible()
}

/** Toggle one of the three inspector tabs (Explorer, Inspector, Execution). */
/**
 * Bring the inspector frame on-canvas. The frame lives inside the session
 * side panel (session-side-panel.tsx) and sits off the right edge when the
 * panel is closed (probe: x=1441 at a 1440 viewport), so the header's
 * "Toggle review" control opens it first.
 */
export async function openInspectorPane(page: Page): Promise<void> {
  const onCanvas = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-action="inspector-toggle"]')
      if (!el) return false
      const rect = el.getBoundingClientRect()
      // The toggle is a narrow icon button (~7-9 px wide) when open, and
      // sits at x=viewportWidth+1 when the panel is collapsed off-canvas.
      return rect.width > 0 && rect.x >= 0 && rect.right <= window.innerWidth + 1
    })
  if (await onCanvas()) return
  await page.getByRole("button", { name: "Toggle review" }).first().click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-action="inspector-toggle"]')
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.x >= 0 && rect.right <= window.innerWidth + 1
  }, undefined, { timeout: 10_000 })
}

export async function pickInspectorTab(
  page: Page,
  tab: "explorer" | "inspector" | "execution",
): Promise<void> {
  // The frame renders three role=tab buttons (data-v110-tab) over a single
  // #v110-inspector-panel whose visibility follows the open state
  // (v110-inspector-frame.tsx).
  await openInspectorPane(page)
  await page.locator(`[role="tab"][data-v110-tab="${tab}"]`).first().click()
  await page.locator("#v110-inspector-panel").first().waitFor({ state: "visible" })
}

/** Measure global horizontal overflow on document.documentElement. */
export async function globalHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
}

/** Check no element on the page has scrollWidth overflowing its clientWidth by more than 6 px. */
export async function overflowReport(page: Page): Promise<{ selector: string; overflow: number }[]> {
  return page.evaluate(() => {
    const offenders: { selector: string; overflow: number }[] = []
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      // A scroll container (overflow-x auto/scroll/hidden/clip) is allowed
      // to have scrollWidth > clientWidth: that is its purpose, not a
      // layout escape. Only flag content that overflows a box which claims
      // it does not (overflow-x: visible), which is the A2-04 bug class.
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX !== "visible") return
      // A collapsed container (width transition at 0, closed panel) keeps
      // its in-flow content at natural width; that scrollWidth is not a
      // visual escape (a clipped ancestor owns it). Unmeasurable boxes are
      // not evidence of a layout bug.
      if (el.clientWidth < 8) return
      const overflow = el.scrollWidth - el.clientWidth
      if (overflow > 6) {
        offenders.push({
          selector: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.split(" ").join(".") : ""}`,
          overflow,
        })
      }
    })
    return offenders
  })
}

/** Wait for the keyboard focus trap to settle on a specific element within a dialog. */
export async function waitForFocusOn(
  page: Page,
  selector: string,
  timeout = 1000,
): Promise<boolean> {
  try {
    await page.locator(selector).focus({ timeout })
    return true
  } catch {
    return false
  }
}

/** Capture an annotated screenshot for visual review; returns the saved path. */
export async function captureAnnotated(
  page: Page,
  label: string,
  dir = "e2e/artifacts",
): Promise<string> {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  await fs.mkdir(path.resolve(dir), { recursive: true })
  const safe = label.replace(/[^a-z0-9-_]/gi, "-").slice(0, 80)
  const file = path.resolve(dir, `${Date.now()}-${safe}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/** Assert the page has no console errors after a viewport change. */
export async function expectNoConsoleErrors(
  page: Page,
  errorCollector: string[],
): Promise<void> {
  if (errorCollector.length > 0) {
    throw new Error(`Unexpected console errors: ${errorCollector.join(" | ")}`)
  }
}

/** Build the canonical shell gate assertion: frame mounted + modes reachable from the active navigation. */
export async function assertShellMounted(page: Page): Promise<void> {
  const frame = page.locator('[data-v110="shell-frame"]')
  await frame.waitFor({ state: "visible" })
  // The 4 shell modes live in the rail on desktop and in the mobile nav
  // below 600px (A2-03). Automate is grant-gated (ADR-1041), so the gate
  // asserts the *present* triggers are registered modes — mirroring the
  // A8-02 strict spec — instead of demanding all four.
  const modes = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        '[data-component="sidebar-rail"] [data-mode], [data-v110="mobile-nav"] [data-mode]',
      ),
    )
    return nodes.map((node) => node.getAttribute("data-mode") ?? "")
  })
  if (modes.length === 0) throw new Error("no mode trigger mounted in the active navigation (rail or mobile-nav)")
  const known = new Set(["code", "work", "design", "automate"])
  for (const mode of modes) {
    if (!known.has(mode)) throw new Error(`navigation exposes an unregistered mode: ${mode}`)
  }
}
