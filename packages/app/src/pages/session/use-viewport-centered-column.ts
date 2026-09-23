/* SPDX-License-Identifier: MIT */

import { createEffect, onCleanup } from "solid-js"

// ADR-045: the reference centres the focused chat on the window, because its
// rail floats over the workspace. Here the rail takes layout space, so the
// surface is off-centre by half the rail; CSS alone cannot know that offset.
export const CHAT_SHIFT_PROPERTY = "--v110-chat-shift"

/** Horizontal distance from the surface's centre to the window's centre. */
export function viewportCenterShift(rect: { left: number; width: number }, viewportWidth: number) {
  return Math.round(viewportWidth / 2 - (rect.left + rect.width / 2))
}

export function useViewportCenteredColumn(surface: () => HTMLElement | undefined, enabled: () => boolean) {
  createEffect(() => {
    const element = surface()
    if (!element) return
    if (!enabled()) {
      element.style.removeProperty(CHAT_SHIFT_PROPERTY)
      return
    }
    const update = () => {
      const shift = viewportCenterShift(element.getBoundingClientRect(), window.innerWidth)
      element.style.setProperty(CHAT_SHIFT_PROPERTY, `${shift}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener("resize", update)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", update)
      element.style.removeProperty(CHAT_SHIFT_PROPERTY)
    })
  })
}
