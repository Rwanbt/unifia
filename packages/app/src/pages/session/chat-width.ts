/* SPDX-License-Identifier: MIT */

// The split chat's width contract, from the reference's chat resize
// controller (module 011): one desired width shared by every mode, never
// under 280px nor over half the workspace (1200px at most). Until the user
// drags the edge, the desired width is the reference's default: 36vw on
// compact desktops, 348px from 1200px up.

export const CHAT_MIN_WIDTH = 280
export const CHAT_ABS_MAX_WIDTH = 1200
const CHAT_DEFAULT_WIDTH = 348
const COMPACT_CHAT_VW = 36

/** The widest the chat may be beside a workspace `workspaceWidth` wide. */
export function chatMaxWidth(workspaceWidth: number): number {
  return Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_ABS_MAX_WIDTH, Math.floor(workspaceWidth * 0.5)))
}

/** The split chat's CSS width; `50%` resolves against the workspace. */
export function splitChatWidth(input: { resized: boolean; width: number; compact: boolean }): string {
  const desired = input.resized
    ? `${Math.round(input.width)}px`
    : input.compact
      ? `${COMPACT_CHAT_VW}vw`
      : `${CHAT_DEFAULT_WIDTH}px`
  return `clamp(${CHAT_MIN_WIDTH}px, ${desired}, min(50%, ${CHAT_ABS_MAX_WIDTH}px))`
}
