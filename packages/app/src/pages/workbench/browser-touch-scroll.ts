/* SPDX-License-Identifier: MIT */

/** Below this travel a touch is a tap, not a scroll (Android's touch slop is ~8 dp). */
export const TOUCH_SLOP_PX = 8
/** Per-frame velocity decay of a fling; ~0.95 at 60 fps matches a native scroller's glide. */
const FLING_FRICTION = 0.95
const MIN_FLING_SPEED_PX_PER_MS = 0.05
/** Only the last stretch of a drag tells how fast the finger left the glass. */
const VELOCITY_WINDOW_MS = 100

type Sample = { x: number; y: number; t: number }

/**
 * Turns one finger's drag over the page image into scroll deltas, in page pixels.
 * `scale` is page pixels per screen pixel: the page is drawn scaled into the surface.
 */
export function createTouchScroll(scale: () => number) {
  let samples: Sample[] = []
  let scrolling = false
  let pendingX = 0
  let pendingY = 0

  const record = (sample: Sample) => {
    samples.push(sample)
    samples = samples.filter((item) => sample.t - item.t <= VELOCITY_WINDOW_MS)
  }

  return {
    start(x: number, y: number, t: number) {
      samples = [{ x, y, t }]
      scrolling = false
      pendingX = 0
      pendingY = 0
    },
    /** Whether the gesture is a scroll (and so must not end as a tap). */
    move(x: number, y: number, t: number): boolean {
      const last = samples.at(-1)
      if (!last) return false
      const first = samples[0]!
      if (!scrolling && Math.hypot(x - first.x, y - first.y) < TOUCH_SLOP_PX) return false
      scrolling = true
      // Dragging the content up scrolls the page down.
      pendingX += (last.x - x) * scale()
      pendingY += (last.y - y) * scale()
      record({ x, y, t })
      return true
    },
    /** The delta accumulated since the last take, to send as one scroll input. */
    take(): { deltaX: number; deltaY: number } | undefined {
      const deltaX = Math.round(pendingX)
      const deltaY = Math.round(pendingY)
      if (deltaX === 0 && deltaY === 0) return undefined
      pendingX -= deltaX
      pendingY -= deltaY
      return { deltaX, deltaY }
    },
    /** Ends the drag; returns the release velocity in page px/ms, or undefined for a tap or a slow release. */
    end(t: number): { x: number; y: number } | undefined {
      const wasScrolling = scrolling
      scrolling = false
      const first = samples[0]
      const last = samples.at(-1)
      samples = []
      if (!wasScrolling || !first || !last || t - last.t > VELOCITY_WINDOW_MS || last.t === first.t) return undefined
      const elapsed = last.t - first.t
      const velocity = { x: ((first.x - last.x) / elapsed) * scale(), y: ((first.y - last.y) / elapsed) * scale() }
      return Math.hypot(velocity.x, velocity.y) < MIN_FLING_SPEED_PX_PER_MS ? undefined : velocity
    },
    get scrolling() {
      return scrolling
    },
  }
}

/** Total glide of a fling released at `velocity` (px/ms), as a native scroller would travel it. */
export function flingDistance(velocity: { x: number; y: number }, frameMs = 1000 / 60): { deltaX: number; deltaY: number } {
  // Sum of a geometric series: v * frame * f / (1 - f).
  const factor = (frameMs * FLING_FRICTION) / (1 - FLING_FRICTION)
  return { deltaX: Math.round(velocity.x * factor), deltaY: Math.round(velocity.y * factor) }
}
