/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { movePathHandle, parsePath, pathBounds, pathHandles, serializePath } from "./path"

describe("design path data", () => {
  test("parses the pen's M/L subset with implicit repetitions", () => {
    expect(parsePath("M 0 0 L 60 0 L 60 60")).toEqual({
      start: { x: 0, y: 0 },
      segments: [
        { kind: "line", to: { x: 60, y: 0 } },
        { kind: "line", to: { x: 60, y: 60 } },
      ],
    })
    expect(parsePath("M0,0L10,20")).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ kind: "line", to: { x: 10, y: 20 } }],
    })
    expect(parsePath("M 0 0 10 10")).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ kind: "line", to: { x: 10, y: 10 } }],
    })
  })

  test("parses cubic and quadratic curves", () => {
    expect(parsePath("M 0 0 C 10 10 20 20 30 30 Q 40 40 50 50")).toEqual({
      start: { x: 0, y: 0 },
      segments: [
        { kind: "cubic", control1: { x: 10, y: 10 }, control2: { x: 20, y: 20 }, to: { x: 30, y: 30 } },
        { kind: "quad", control: { x: 40, y: 40 }, to: { x: 50, y: 50 } },
      ],
    })
  })

  test("round-trips serialized data", () => {
    const source = parsePath("M 0 0 C 10 10 20 20 30 30 Q 40 40 50 50 L 60 60")
    if (!source) throw new Error("expected the sample path to parse")
    expect(serializePath(source)).toBe("M 0 0 C 10 10 20 20 30 30 Q 40 40 50 50 L 60 60")
    expect(parsePath(serializePath(source))).toEqual(source)
  })

  test("refuses unsupported or malformed input", () => {
    expect(parsePath("m 0 0 l 10 10")).toBeUndefined()
    expect(parsePath("M 0 0 Z")).toBeUndefined()
    expect(parsePath("M 0 0 A 5 5 0 0 0 10 10")).toBeUndefined()
    expect(parsePath("M 0 0 H 10")).toBeUndefined()
    expect(parsePath("M 0 0 M 10 10")).toBeUndefined()
    expect(parsePath("M 0 0")).toBeUndefined()
    expect(parsePath("M 0 0 C 10 10 20 20")).toBeUndefined()
    expect(parsePath("M 0 0 Q 10 10")).toBeUndefined()
    expect(parsePath("hello world")).toBeUndefined()
    expect(parsePath("M 0 0 L 10 NaN")).toBeUndefined()
  })

  test("computes tight bounds from curve extrema", () => {
    const cubic = parsePath("M 0 0 C 0 -60 60 -60 60 0")
    if (!cubic) throw new Error("expected the sample cubic to parse")
    expect(pathBounds(cubic)).toEqual({ x: 0, y: -45, width: 60, height: 45 })
    const quad = parsePath("M 0 0 Q 30 90 60 60")
    if (!quad) throw new Error("expected the sample quad to parse")
    expect(pathBounds(quad)).toEqual({ x: 0, y: 0, width: 60, height: 67.5 })
    expect(pathBounds({ start: { x: 0, y: 0 }, segments: [] })).toBeUndefined()
    expect(pathBounds({ start: { x: 0, y: 0 }, segments: [{ kind: "line", to: { x: Number.NaN, y: 0 } }] })).toBeUndefined()
  })

  test("enumerates anchors and controls with their tethers", () => {
    const data = parsePath("M 0 0 Q 30 30 60 60")
    if (!data) throw new Error("expected the sample quad to parse")
    const handles = pathHandles(data)
    expect(handles.map((entry) => entry.handle)).toEqual([
      { kind: "anchor", index: 0 },
      { kind: "control", index: 0, which: "single" },
      { kind: "anchor", index: 1 },
    ])
    expect(handles[1]?.anchor).toBe(handles[0]?.point)
  })

  test("moves a cubic anchor with its attached controls", () => {
    const data = parsePath("M 0 0 C 10 10 20 20 30 30")
    if (!data) throw new Error("expected the sample cubic to parse")
    expect(movePathHandle(data, { kind: "anchor", index: 1 }, { x: 40, y: 30 })).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ kind: "cubic", control1: { x: 10, y: 10 }, control2: { x: 30, y: 20 }, to: { x: 40, y: 30 } }],
    })
  })

  test("moves a single control handle", () => {
    const data = parsePath("M 0 0 C 10 10 20 20 30 30")
    if (!data) throw new Error("expected the sample cubic to parse")
    const moved = movePathHandle(data, { kind: "control", index: 0, which: "first" }, { x: 15, y: 0 })
    expect(moved).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ kind: "cubic", control1: { x: 15, y: 0 }, control2: { x: 20, y: 20 }, to: { x: 30, y: 30 } }],
    })
  })

  test("keeps quad controls in place when an anchor moves", () => {
    const data = parsePath("M 0 0 Q 30 30 60 60")
    if (!data) throw new Error("expected the sample quad to parse")
    expect(movePathHandle(data, { kind: "anchor", index: 1 }, { x: 60, y: 80 })).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ kind: "quad", control: { x: 30, y: 30 }, to: { x: 60, y: 80 } }],
    })
  })
})
