/* SPDX-License-Identifier: MIT */

export const MIN_CHAT_WIDTH = 320
export const MAX_CHAT_WIDTH = 720
export const DEFAULT_CHAT_WIDTH = 460
export const KEYBOARD_STEP = 16

export function clampChatWidth(requested: number): number {
  if (Number.isNaN(requested)) return DEFAULT_CHAT_WIDTH
  return Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, requested))
}
