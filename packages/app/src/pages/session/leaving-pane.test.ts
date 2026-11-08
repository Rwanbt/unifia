/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { leavingGeometry, leavingStyle } from "./leaving-pane"

const rect = (left: number, width: number) => ({ left, width }) as DOMRect

describe("leaving pane geometry", () => {
  test("LeavingGeometry_SplitPane_KeepsWidthAndClearsRightEdge", () => {
    // Workspace 1000px at x=100; pane 600px starting 400px in, 10px margin.
    const geometry = leavingGeometry(rect(100, 1000), rect(500, 600), 10)
    expect(geometry).toEqual({ left: 390, width: 600, shift: 600 })
  })

  test("LeavingGeometry_PaneOverflowingWorkspace_NeverShiftsLeft", () => {
    expect(leavingGeometry(rect(0, 500), rect(600, 300)).shift).toBe(0)
  })

  test("LeavingStyle_NoGeometry_SetsNothing", () => {
    expect(leavingStyle(undefined)).toBeUndefined()
    expect(leavingStyle({ left: 1, width: 2, shift: 3 })).toEqual({
      "--v110-leaving-left": "1px",
      "--v110-leaving-width": "2px",
      "--v110-leaving-shift": "3px",
    })
  })
})
