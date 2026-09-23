/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { contextLevel } from "./session-context-level"

describe("contextLevel", () => {
  test("follows the reference thresholds", () => {
    expect(contextLevel(0)).toBe("ok")
    expect(contextLevel(69)).toBe("ok")
    expect(contextLevel(70)).toBe("warn")
    expect(contextLevel(84)).toBe("warn")
    expect(contextLevel(85)).toBe("danger")
  })
})
