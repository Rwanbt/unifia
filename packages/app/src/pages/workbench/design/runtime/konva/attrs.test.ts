/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { commitTransform, toKonvaAttrs } from "./attrs"

describe("konva attrs", () => {
  test("toKonvaAttrs moves the origin to the node centre", () => {
    expect(toKonvaAttrs({ x: 10, y: 20, width: 100, height: 40, rotation: 30 })).toEqual({
      x: 60,
      y: 40,
      offsetX: 50,
      offsetY: 20,
      rotation: 30,
    })
  })

  test("commitTransform persists a drag as a canonical move", () => {
    const next = commitTransform(
      { x: 10, y: 20, width: 100, height: 40, rotation: 0 },
      { x: 160, y: 140, rotation: 0, scaleX: 1, scaleY: 1 },
    )
    expect(next).toEqual({ x: 110, y: 120, width: 100, height: 40, rotation: 0 })
  })

  test("commitTransform folds resize scale into width and height", () => {
    const next = commitTransform(
      { x: 10, y: 20, width: 100, height: 40, rotation: 45 },
      { x: 160, y: 140, rotation: 45, scaleX: 2, scaleY: 0.5 },
    )
    expect(next).toEqual({ x: 60, y: 130, width: 200, height: 20, rotation: 45 })
  })

  test("negative scale is treated as magnitude, never a negative size", () => {
    const next = commitTransform(
      { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
      { x: 50, y: 20, rotation: 0, scaleX: -2, scaleY: -0.5 },
    )
    expect(next.width).toBe(200)
    expect(next.height).toBe(20)
  })
})
