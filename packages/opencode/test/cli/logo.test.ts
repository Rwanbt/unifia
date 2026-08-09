// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { describe, expect, test } from "bun:test"
import { logo } from "../../src/cli/logo"

describe("Unifia CLI lockup", () => {
  test("keeps the approved 38-column, five-row split", () => {
    expect(logo.left).toHaveLength(5)
    expect(logo.right).toHaveLength(5)
    expect(logo.left[4]).toBe("████████")
    expect(logo.right[0]).toContain("▀▀  ████  ▀▀")
    expect(logo.left.every((row) => row.length === 8)).toBe(true)
    expect(logo.left[0].length + 2 + logo.right[0].length).toBe(38)
  })
})
