/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createTouchScroll, flingDistance } from "@/pages/workbench/browser-touch-scroll"

describe("createTouchScroll", () => {
  test("TouchScroll_SmallTravel_StaysATap", () => {
    const scroll = createTouchScroll(() => 1)
    scroll.start(100, 300, 0)
    expect(scroll.move(103, 304, 16)).toBe(false)
    expect(scroll.take()).toBeUndefined()
    expect(scroll.end(40)).toBeUndefined()
  })

  test("TouchScroll_DragUp_ScrollsThePageDownInPagePixels", () => {
    const scroll = createTouchScroll(() => 2)
    scroll.start(100, 300, 0)
    expect(scroll.move(100, 280, 16)).toBe(true)
    expect(scroll.move(100, 250, 32)).toBe(true)
    // The whole travel counts, including the stretch before the slop was crossed: (20 + 30) x 2.
    expect(scroll.take()).toEqual({ deltaX: 0, deltaY: 100 })
    expect(scroll.take()).toBeUndefined()
  })

  test("TouchScroll_FastRelease_Flings_SlowOrLateReleaseDoesNot", () => {
    const fast = createTouchScroll(() => 1)
    fast.start(0, 400, 0)
    fast.move(0, 380, 16)
    fast.move(0, 300, 48)
    const velocity = fast.end(50)
    expect(velocity?.y).toBeGreaterThan(0)

    const late = createTouchScroll(() => 1)
    late.start(0, 400, 0)
    late.move(0, 300, 48)
    expect(late.end(400)).toBeUndefined()
  })
})

describe("flingDistance", () => {
  test("Fling_GlidesFurtherTheFasterItIsReleased", () => {
    const slow = flingDistance({ x: 0, y: 0.5 })
    const quick = flingDistance({ x: 0, y: 2 })
    expect(slow.deltaY).toBeGreaterThan(0)
    expect(Math.abs(quick.deltaY - slow.deltaY * 4)).toBeLessThanOrEqual(2)
  })
})
