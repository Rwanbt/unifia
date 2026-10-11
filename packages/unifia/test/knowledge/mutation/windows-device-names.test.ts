/* SPDX-License-Identifier: MIT */
/**
 * A name Windows reserves for a device is not a file: a read or a write at that name waits on the device, or writes to it.
 * The check is pure, so it runs on every platform even though the refusal applies on Windows only.
 */

import { describe, it, expect } from "bun:test"
import { isWindowsDeviceName } from "../../../src/knowledge/mutation/durability.js"

describe("a Windows device name is recognised, whatever its extension", () => {
  it("CON, PRN, AUX, NUL, COMn and LPTn are device names, with or without an extension", () => {
    for (const name of ["CON.md", "nul", "com1.txt", "LPT9.md", "aux", "Prn.md"]) {
      expect(isWindowsDeviceName(name)).toBe(true)
    }
  })

  it("an ordinary name that begins with a device name is not", () => {
    for (const name of ["CONTRACT.md", "console.md", "com10.md", "notes.md", "lpt0.md"]) {
      expect(isWindowsDeviceName(name)).toBe(false)
    }
  })
})
