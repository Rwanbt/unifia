/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { randomString } from "./random"

describe("randomString", () => {
  test("returns the requested length over the alphabet", () => {
    const out = randomString("abc", 40)
    expect(out).toHaveLength(40)
    expect(out).toMatch(/^[abc]+$/)
  })

  test("drops bytes past the last whole multiple instead of folding them in", () => {
    // 62 characters: 256 - 256 % 62 = 248, so 248..255 must be redrawn.
    const feed = [255, 254, 253, 252, 251, 250, 249, 248, 0, 1, 2, 61]
    let cursor = 0
    const out = randomString("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 4, (bytes) => {
      for (let index = 0; index < bytes.length; index++) bytes[index] = feed[cursor++ % feed.length]!
    })
    expect(out).toBe("012z")
  })

  test("every character of a small alphabet is reachable and roughly even", () => {
    const counts = new Map<string, number>()
    for (const char of randomString("ab", 20_000)) counts.set(char, (counts.get(char) ?? 0) + 1)
    expect(counts.get("a")! / 20_000).toBeGreaterThan(0.45)
    expect(counts.get("a")! / 20_000).toBeLessThan(0.55)
  })

  test("refuses an alphabet a byte cannot index", () => {
    expect(() => randomString("a", 4)).toThrow(RangeError)
    expect(() => randomString("x".repeat(257), 4)).toThrow(RangeError)
  })
})
