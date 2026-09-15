/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { parsePathPoints, serializePathPoints } from "./path"

describe("design path data", () => {
  test("parses the pen's M/L subset", () => {
    expect(parsePathPoints("M 0 0 L 60 0 L 60 60")).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
    ])
    expect(parsePathPoints("M0,0L10,20")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ])
  })

  test("round-trips serialized points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 30 },
      { x: 30, y: 90 },
    ]
    expect(parsePathPoints(serializePathPoints(points) ?? "")).toEqual(points)
  })

  test("refuses curves, relative commands and malformed input", () => {
    expect(parsePathPoints("M 0 0 C 10 10 20 20 30 30")).toBeUndefined()
    expect(parsePathPoints("m 0 0 l 10 10")).toBeUndefined()
    expect(parsePathPoints("M 0 0 Z")).toBeUndefined()
    expect(parsePathPoints("M 0 0")).toBeUndefined()
    expect(parsePathPoints("hello world")).toBeUndefined()
    expect(parsePathPoints("M 0 0 L 10 NaN")).toBeUndefined()
  })

  test("serialization refuses fewer than two points", () => {
    expect(serializePathPoints([{ x: 0, y: 0 }])).toBeUndefined()
  })
})
