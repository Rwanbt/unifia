/* SPDX-License-Identifier: MIT */
export const MIN_MOBILE_TERMINAL_HEIGHT = 20
export const MAX_MOBILE_TERMINAL_HEIGHT = 95

export function clampMobileTerminalHeight(height: number) {
  return Math.max(MIN_MOBILE_TERMINAL_HEIGHT, Math.min(MAX_MOBILE_TERMINAL_HEIGHT, height))
}

export function mobileTerminalDragHeight(startHeight: number, startY: number, currentY: number, containerHeight: number) {
  return clampMobileTerminalHeight(((startHeight + startY - currentY) / containerHeight) * 100)
}
