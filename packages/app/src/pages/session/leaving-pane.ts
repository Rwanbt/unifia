/* SPDX-License-Identifier: MIT */

import { createEffect, createSignal, on, type Accessor } from "solid-js"
import type { JSX } from "solid-js"

/** The main pane root every mode renders (session-editor-surface, *-surface). */
const MAIN_PANE = ':scope > [data-v110="mode-main"]'

export type LeavingGeometry = { left: number; width: number; shift: number }

/**
 * Where the leaving pane sits when its exit starts, and how far it must move
 * to clear the workspace's right edge. Pure, so it is unit-tested.
 */
export function leavingGeometry(workspace: DOMRect, pane: DOMRect, marginLeft = 0): LeavingGeometry {
  const border = pane.left - workspace.left
  // `left` places the margin box; the pane keeps its margin when pinned.
  return { left: border - marginLeft, width: pane.width, shift: Math.max(0, workspace.width - border) }
}

/** The CSS variables v110-editor.css reads to pin and slide the leaving pane. */
export function leavingStyle(geometry: LeavingGeometry | undefined): JSX.CSSProperties | undefined {
  if (!geometry) return undefined
  return {
    "--v110-leaving-left": `${geometry.left}px`,
    "--v110-leaving-width": `${geometry.width}px`,
    "--v110-leaving-shift": `${geometry.shift}px`,
  }
}

/**
 * Freezes the main pane's geometry when it starts leaving (Split/Editor ->
 * Chat, while createExitHold keeps it mounted).
 * WHY: a mounted-but-flowing pane shrank as the chat pane widened, so it
 * compacted against the right edge before vanishing. Pinned at its width it
 * can slide out instead, the reverse of opening.
 */
export function createLeavingPane(
  workspace: Accessor<HTMLElement | undefined>,
  leaving: Accessor<boolean>,
): Accessor<LeavingGeometry | undefined> {
  const [geometry, setGeometry] = createSignal<LeavingGeometry>()
  createEffect(
    on(leaving, (now) => {
      const root = workspace()
      const pane = now ? root?.querySelector<HTMLElement>(MAIN_PANE) : undefined
      if (!root || !pane) return setGeometry(undefined)
      const margin = Number.parseFloat(getComputedStyle(pane).marginLeft) || 0
      setGeometry(leavingGeometry(root.getBoundingClientRect(), pane.getBoundingClientRect(), margin))
    }),
  )
  return geometry
}
