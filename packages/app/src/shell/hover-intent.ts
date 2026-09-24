/* SPDX-License-Identifier: MIT */

// Hover-to-peek for the reference's floating panels (account quick menu,
// compute popover, terminal; Unifia-UI-UX-v110-PORT-READY-R1.html
// ~25915-26030): the panel opens after the pointer rests on its trigger,
// stays open while the pointer is on the trigger or the panel, and closes
// a moment after it leaves both. A click pins it: a pinned panel ignores
// the pointer until it is closed. Mouse and pen only -- touch has no hover.

export const HOVER_OPEN_DELAY = 190
export const HOVER_CLOSE_DELAY = 360

export type HoverIntent = {
  enterTrigger: (event: PointerEvent) => void
  leaveTrigger: () => void
  enterPanel: () => void
  leavePanel: () => void
  /** A click: the panel is the user's now, the pointer no longer closes it. */
  pin: () => void
  /** The panel closed by any other means (Escape, outside click). */
  reset: () => void
  peeking: () => boolean
}

type Options = {
  open: () => void
  close: () => void
  isOpen: () => boolean
  openDelay?: number
  closeDelay?: number
  /** Whether the pointer is really over the trigger or the panel (`:hover`),
   * checked before closing: an element re-rendered under a still pointer can
   * fire a spurious leave. */
  hovered?: () => boolean
}

export function createHoverIntent(options: Options): HoverIntent {
  let onTrigger = false
  let onPanel = false
  let peek = false
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
  }

  const scheduleClose = () => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      if (!peek || onTrigger || onPanel || options.hovered?.()) return
      peek = false
      options.close()
    }, options.closeDelay ?? HOVER_CLOSE_DELAY)
  }

  return {
    enterTrigger(event) {
      if (event.pointerType === "touch") return
      onTrigger = true
      clear()
      if (options.isOpen()) return
      openTimer = setTimeout(() => {
        if (!onTrigger || options.isOpen()) return
        peek = true
        options.open()
      }, options.openDelay ?? HOVER_OPEN_DELAY)
    },
    leaveTrigger() {
      onTrigger = false
      scheduleClose()
    },
    enterPanel() {
      onPanel = true
      clearTimeout(closeTimer)
    },
    leavePanel() {
      onPanel = false
      scheduleClose()
    },
    pin() {
      clear()
      peek = false
    },
    reset() {
      clear()
      peek = false
      onPanel = false
    },
    peeking: () => peek,
  }
}
