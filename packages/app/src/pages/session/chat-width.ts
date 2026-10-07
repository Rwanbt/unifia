/* SPDX-License-Identifier: MIT */

// The split chat's width contract, from the reference's chat resize
// controller (module 011): one desired width shared by every mode, never
// under 280px nor over half the workspace (1200px at most). Until the user
// drags the edge, compact desktops use the reference's 36vw; wider ones get
// the layout's viewport default (tokens/panels: 348px, 330px up to 1360px).

import type { Layout, Side } from "@/tokens/viewport"

export const CHAT_MIN_WIDTH = 280
export const CHAT_ABS_MAX_WIDTH = 1200
const COMPACT_CHAT_VW = 36
const COMPACT_SIDE_CHAT = "clamp(240px, 28vw, 290px)"

/** The widest the chat may be beside a workspace `workspaceWidth` wide. */
export function chatMaxWidth(workspaceWidth: number): number {
  return Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_ABS_MAX_WIDTH, Math.floor(workspaceWidth * 0.5)))
}

/** The split chat's CSS width; `50%` resolves against the workspace. */
export function splitChatWidth(input: {
  resized: boolean
  width: number
  compact: boolean
  sidePanelOpen?: boolean
}): string {
  // Compact desktops with the context or inspector open: the reference fixes
  // the chat at clamp(240px, 28vw, 290px) whatever the user's width.
  if (input.compact && input.sidePanelOpen) return COMPACT_SIDE_CHAT
  const desired = input.compact && !input.resized ? `${COMPACT_CHAT_VW}vw` : `${Math.round(input.width)}px`
  return `clamp(${CHAT_MIN_WIDTH}px, ${desired}, min(50%, ${CHAT_ABS_MAX_WIDTH}px))`
}

/** The session chat pane's CSS width for the layout the viewport shows. */
export function sessionChatWidth(input: {
  layout: Layout
  side: Side
  resized: boolean
  width: number
  sidebarOpen: boolean
  inspectorOpen: boolean
  inspectorWidth: number
  mobileDevice: boolean
}): string {
  // Chat and Editor share the phone screen as exclusive views; main-pane
  // destinations use that same full-screen Editor track.
  if (input.layout === "main") return "0px"
  // Wide Chat layout: the surface is the focused column itself, centred by
  // v110-chat.css, so switching layouts animates one box (ADR-053).
  if (input.layout === "chat" && input.side === "grid") return "var(--v110-chat-column)"
  // Split is only shown where the viewport offers it (fitLayout). Compact
  // landscape offers it with an overlay side, and a full-width chat there left
  // the main pane 0px wide (docs/audit/RC0-COMPACT-LANDSCAPE-MAIN-COLLAPSE.md).
  if (input.layout === "split")
    return splitChatWidth({
      resized: input.resized,
      width: input.width,
      compact: input.side !== "grid",
      sidePanelOpen: input.sidebarOpen || input.inspectorOpen,
    })
  if (!input.inspectorOpen) return "100%"
  if (input.mobileDevice) return "50%"
  // The inspector card also takes its outer and inner gutters.
  return `calc(100% - ${input.inspectorWidth}px - var(--v110-inspector-margins))`
}
