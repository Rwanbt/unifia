/* SPDX-License-Identifier: MIT */

// A1 Wave 0 — canonical v110 panel contract (manifest build
// v110-port-ready-r1, authorities LayoutControllerV98 / CanonicalV110).
// Pure: no DOM, no signals. Widths mirror styles/v110.css; the CSS owns
// rendering, this module owns logic (invariants, clamps, visibility).

import type { Side, Viewport } from "@/tokens/viewport"

export const TOPBAR = 48
export const RAIL = 78
export const RAIL_COMPACT = 62
export const CONTEXT = 248
export const INSPECTOR = 300
export const CHAT = 348
export const CHAT_MIN = 280
export const CHAT_MAX = 620
export const NARROW = 1360
export const CONTEXT_NARROW = 220
export const CHAT_NARROW = 330
export const INSPECTOR_NARROW = 280
// Below 1200px the context and inspector become floating cards (ADR-053).
export const WIDE_MIN = 1200
export const CONTEXT_FLOATING = 300
export const INSPECTOR_FLOATING = 320

export type Panel = "context" | "inspector"
// Graph is a Memory sub-view, never a global layout (COMPONENT-MAP §1).
export type MemoryView = "note" | "graph"

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function narrow(width: number): boolean {
  return width <= NARROW
}

export function width(panel: Panel | "chat", viewport: number): number {
  const floating = viewport < WIDE_MIN
  if (panel === "context") return floating ? CONTEXT_FLOATING : narrow(viewport) ? CONTEXT_NARROW : CONTEXT
  if (panel === "inspector") return floating ? INSPECTOR_FLOATING : narrow(viewport) ? INSPECTOR_NARROW : INSPECTOR
  return narrow(viewport) ? CHAT_NARROW : CHAT
}

// Visible panels for one viewport given the panels opened last-first.
// desktop-wide cohabits; desktop-compact keeps the last opened only;
// overlays render the full stack with the last opened on top.
export function visible(open: Panel[], id: Viewport): Panel[] {
  const order = open.filter((panel, index) => open.indexOf(panel) === index)
  if (id === "desktop-compact") return order.slice(-1)
  return order
}

// The workspace's left edge beside the rail and the context panel, measured
// on the reference (ADR-053). Wide: 20px outer gutter, then 10px after the
// rail and after the panel. Compact: the panel card overlaps the rail by 2px
// and sits 22px from the workspace (12px without the rail). A hidden rail's
// column keeps a 20px gutter; overlay shells float the panel over the
// workspace. `rail` is the rail's own track (--v110-rail), the rest is px.
export function workspaceLeft(input: { rail: boolean; context: boolean; panel: number; side: Side }): string {
  const grid = input.side === "grid"
  if (input.context && input.side !== "overlay") {
    if (input.rail) return `calc(var(--v110-rail, 62px) + ${input.panel + (grid ? 40 : 30)}px)`
    return `${input.panel + (grid ? 30 : 20)}px`
  }
  if (!input.rail) return "20px"
  return "calc(var(--v110-rail, 62px) + 30px)"
}
