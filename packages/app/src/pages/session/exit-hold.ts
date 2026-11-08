/* SPDX-License-Identifier: MIT */

import { createSignal, createEffect, on, onCleanup, type Accessor } from "solid-js"

/** The chat surface's width transition (session.tsx), in milliseconds. */
export const LAYOUT_TRANSITION_MS = 620

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Keeps a surface mounted while it leaves: true as soon as `visible` turns
 * true, and still true for `durationMs` after it turns false.
 * WHY: switching Split/Editor -> Chat unmounted the main surface at once while
 * the chat pane's width was still animating, so closing looked instant while
 * opening slid. Holding the mount for the transition makes closing the
 * reverse of opening. Reduced motion drops the hold, like the transition.
 */
export function createExitHold(
  visible: Accessor<boolean>,
  durationMs: number = LAYOUT_TRANSITION_MS,
  reducedMotion: () => boolean = prefersReducedMotion,
): Accessor<boolean> {
  const [mounted, setMounted] = createSignal(visible())
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  createEffect(
    on(
      visible,
      (next) => {
        clear()
        if (next || durationMs <= 0 || reducedMotion()) return setMounted(next)
        timer = setTimeout(() => {
          timer = undefined
          setMounted(false)
        }, durationMs)
      },
      { defer: true },
    ),
  )
  onCleanup(clear)
  return mounted
}
