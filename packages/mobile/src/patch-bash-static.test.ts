/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { patchFaccessat2 } from "../scripts/patch-bash-static.mjs"

const words = (...values: number[]) => {
  const bytes = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4))
  return bytes
}
const NOP = 0xd503201f
const FACCESSAT2_SITE = [0xd28036e8, 0xd4000001, 0x3100981f] // mov x8,#439; svc #0; cmn w0,#38

describe("patchFaccessat2", () => {
  test("turns the faccessat2 svc into movn x0, #37 and leaves the rest untouched", () => {
    const input = words(NOP, ...FACCESSAT2_SITE, NOP)
    const { patched, offset } = patchFaccessat2(input)
    expect(offset).toBe(8)
    expect(patched.readUInt32LE(8)).toBe(0x928004a0)
    expect(patched.readUInt32LE(4)).toBe(0xd28036e8)
    expect(patched.readUInt32LE(12)).toBe(0x3100981f)
    expect(input.readUInt32LE(8)).toBe(0xd4000001)
  })

  test("refuses a build without the expected syscall site", () => {
    expect(() => patchFaccessat2(words(NOP, NOP, NOP))).toThrow("found 0")
  })

  test("refuses an ambiguous build with several sites", () => {
    expect(() => patchFaccessat2(words(...FACCESSAT2_SITE, ...FACCESSAT2_SITE))).toThrow("found 2")
  })
})
