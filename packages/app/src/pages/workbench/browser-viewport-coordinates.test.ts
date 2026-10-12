/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { browserViewportPoint } from "./browser-viewport-coordinates"

describe("browserViewportPoint", () => {
  test("maps clicks through horizontal letterboxing", () => {
    expect(browserViewportPoint(
      { x: 300, y: 250 },
      { left: 100, top: 50, width: 800, height: 400 },
      { width: 1280, height: 800 },
      { width: 1280, height: 800 },
    )).toEqual({ x: 240, y: 400 })
  })

  test("rejects clicks in the letterbox and invalid dimensions", () => {
    expect(browserViewportPoint(
      { x: 150, y: 60 },
      { left: 100, top: 50, width: 800, height: 500 },
      { width: 1280, height: 720 },
      { width: 1280, height: 800 },
    )).toBeUndefined()
    expect(browserViewportPoint({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 1 }, { width: 1, height: 1 }, { width: 1, height: 1 })).toBeUndefined()
  })
})
