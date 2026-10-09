// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import { shellCommand } from "./command-witness"

test("PowerShell witnesses use literal paths and escape apostrophes", () => {
  expect(shellCommand("D:\\fixture space\\owner's.txt", "powershell")).toBe(
    "Set-Content -LiteralPath 'D:\\fixture space\\owner''s.txt' -Value rc0-harmless",
  )
  expect(shellCommand("D:\\fixture.txt", "pwsh")).toBe(
    "Set-Content -LiteralPath 'D:\\fixture.txt' -Value rc0-harmless",
  )
})

test("POSIX witnesses normalize Windows paths and escape apostrophes", () => {
  expect(shellCommand("D:\\fixture space\\owner's.txt", "bash")).toBe(
    "printf rc0-harmless > 'D:/fixture space/owner'\\''s.txt'",
  )
})

test("cmd witnesses quote paths with spaces", () => {
  expect(shellCommand("D:\\fixture space\\marker.txt", "cmd")).toBe(
    'echo rc0-harmless > "D:\\fixture space\\marker.txt"',
  )
})
