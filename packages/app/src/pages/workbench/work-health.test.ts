/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { workHealth } from "./work-health"

describe("workHealth", () => {
  test("empty state stays On track (matching the mockup's all-clear)", () => {
    expect(workHealth({ runStatuses: [], taskStatuses: [], gateVerdicts: [] })).toBe("ok")
  })

  test("a failed run is Off track even when every task looks fine", () => {
    expect(workHealth({ runStatuses: ["failed"], taskStatuses: ["completed"], gateVerdicts: [] })).toBe("off")
  })

  test("a blocked task is At risk", () => {
    expect(workHealth({ runStatuses: ["running"], taskStatuses: ["blocked"], gateVerdicts: [] })).toBe("risk")
  })

  test("a gate awaiting a human verdict is At risk", () => {
    expect(workHealth({ runStatuses: ["running"], taskStatuses: ["running"], gateVerdicts: ["CHANGES_REQUESTED"] })).toBe("risk")
  })

  test("a failed run outranks At risk", () => {
    expect(
      workHealth({ runStatuses: ["failed"], taskStatuses: ["blocked"], gateVerdicts: ["CHANGES_REQUESTED"] }),
    ).toBe("off")
  })

  test("approved gates and healthy tasks stay On track", () => {
    expect(workHealth({ runStatuses: ["running"], taskStatuses: ["completed"], gateVerdicts: ["APPROVED"] })).toBe("ok")
  })
})
