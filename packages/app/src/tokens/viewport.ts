/* SPDX-License-Identifier: MIT */

// A1 Wave 0 — canonical v110 viewport contract (manifest build
// v110-port-ready-r1, authorities ResponsiveV98 / PortReadyV110).
// Pure: no DOM, no signals. A2 wires this into the single responsive
// store; use-mobile-layout and design-responsive keep working until then.

export const WIDE = 1200
export const COMPACT = 900
// Portrait phones run up to 700px: the reference's v99.2 layer treats
// 600-700px portrait as a phone, not a half-tablet (ADR-053).
export const PHONE_PORTRAIT = 700
export const LANDSCAPE_H = 560
export const LANDSCAPE_W = 980

export type Viewport = "desktop-wide" | "desktop-compact" | "tablet-portrait" | "phone-portrait" | "compact-landscape"
export type Side = "grid" | "single" | "overlay"
export type Layout = "chat" | "split" | "main"

export function classify(width: number, height: number): Viewport {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "desktop-wide"
  if (height <= LANDSCAPE_H && width <= LANDSCAPE_W && width > height) return "compact-landscape"
  if (width >= WIDE) return "desktop-wide"
  if (width >= COMPACT) return "desktop-compact"
  // WHY two gap buckets: the manifest leaves 840-899 portrait and 600-899
  // landscape unnamed. Portrait under 900 stays tablet (overlay, chat/main);
  // landscape under 900 joins desktop-compact (single utility, split kept).
  if (width > height) return "desktop-compact"
  if (width > PHONE_PORTRAIT) return "tablet-portrait"
  return "phone-portrait"
}

export function side(id: Viewport): Side {
  if (id === "desktop-wide") return "grid"
  if (id === "desktop-compact") return "single"
  return "overlay"
}

export function layouts(id: Viewport): Layout[] {
  if (id === "tablet-portrait" || id === "phone-portrait") return ["chat", "main"]
  return ["chat", "split", "main"]
}

/** The layout actually shown: one this viewport does not offer (Split on
 * portrait tablets and phones) shows the main surface, as the reference does. */
export function fitLayout(layout: Layout, id: Viewport): Layout {
  return layouts(id).includes(layout) ? layout : "main"
}

export function cohabit(id: Viewport): boolean {
  return id === "desktop-wide"
}

export function exclusive(id: Viewport): boolean {
  return id === "desktop-compact"
}

/** Whether the mode rail is docked beside the workspace, or folded into the drawer.
 *
 * NOT the same question as `side(id)`. `side` is about the mode grid and returns
 * `overlay` for portrait tablets; the shell keeps a real rail there.
 *
 * Only a phone folds the rail away. The reference hides `#rail` at
 * `(max-width:599px)`, at `(max-width:700px) and (orientation:portrait)` and at
 * `(max-height:520px) and (max-width:899px) and (orientation:landscape)`
 * (docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html). 700 is
 * `PHONE_PORTRAIT`, so the portrait rules land on this predicate exactly.
 *
 * The landscape rule is deliberately NOT followed, and that is a decision, not an
 * oversight. Its sibling in the same reference requires `pointer:coarse`, and the
 * product implements that one as "phones held in landscape" (v110.css:622). This
 * viewport is a 390px-tall desktop window with a fine pointer: hiding the rail
 * there would leave the mode buttons with no reachable container, because the
 * bottom nav is only rendered under the mobile sheet
 * (`pages/layout.tsx:1118` passes `mobile`, `:1056` does not).
 *
 * Measured on dev@45245abf13 across all 16 WAVE05 viewports: the rail is present
 * at 1440, 1280, 1024, 768, 1200, 1199, 900, 899, 701, 981x390, 844x390 and
 * 844x561, and absent at 390, 360 and 700 portrait. 16 of 16 agree.
 */
export function dockedRail(id: Viewport): boolean {
  return id !== "phone-portrait"
}

export type Case = { id: Viewport; width: number; height: number }

// Certification cases from the manifest e2eContract (A8 Port Gate).
export const CASES: Case[] = [
  { id: "desktop-wide", width: 1440, height: 900 },
  { id: "desktop-compact", width: 1024, height: 768 },
  { id: "tablet-portrait", width: 768, height: 1024 },
  { id: "phone-portrait", width: 390, height: 844 },
  { id: "compact-landscape", width: 844, height: 390 },
]
