/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { viewportCenterShift } from "./use-viewport-centered-column"

describe("viewportCenterShift", () => {
  test("a surface pushed right by the rail shifts its column back left by half the rail", () => {
    expect(viewportCenterShift({ left: 93, width: 1346 }, 1440)).toBe(-46)
  })

  test("a surface already centred on the window needs no shift", () => {
    expect(viewportCenterShift({ left: 100, width: 1240 }, 1440)).toBe(0)
  })

  test("a surface narrowed by the inspector on the right shifts its column right", () => {
    expect(viewportCenterShift({ left: 93, width: 1000 }, 1440)).toBe(127)
  })
})
