/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { clampZoom, designZoomLimits, panBy, screenToWorld, worldToScreen, zoomAt } from "./viewport"

describe("design viewport", () => {
  test("clampZoom keeps zoom inside the editor limits", () => {
    expect(clampZoom(10)).toBe(designZoomLimits.max)
    expect(clampZoom(0.01)).toBe(designZoomLimits.min)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  test("screen and world conversions round-trip", () => {
    const viewport = { panX: 120, panY: -30, zoom: 1.75 }
    const world = { x: 42, y: 7 }
    const back = screenToWorld(viewport, worldToScreen(viewport, world))
    expect(back.x).toBeCloseTo(world.x, 10)
    expect(back.y).toBeCloseTo(world.y, 10)
  })

  test("zoomAt keeps the anchored world point fixed", () => {
    const viewport = { panX: 100, panY: 50, zoom: 1 }
    const anchor = { x: 200, y: 100 }
    const world = screenToWorld(viewport, anchor)
    const zoomed = zoomAt(viewport, 2, anchor)
    expect(zoomed.zoom).toBe(2)
    const screen = worldToScreen(zoomed, world)
    expect(screen.x).toBeCloseTo(anchor.x, 10)
    expect(screen.y).toBeCloseTo(anchor.y, 10)
  })

  test("zoomAt clamps at the upper limit", () => {
    const viewport = { panX: 0, panY: 0, zoom: designZoomLimits.max }
    expect(zoomAt(viewport, 4, { x: 50, y: 50 }).zoom).toBe(designZoomLimits.max)
  })

  test("panBy translates the viewport", () => {
    const viewport = { panX: 10, panY: 20, zoom: 1 }
    expect(panBy(viewport, 5, -5)).toEqual({ panX: 15, panY: 15, zoom: 1 })
  })
})
