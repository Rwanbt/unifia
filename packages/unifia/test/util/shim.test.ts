// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import { isShim, quote } from "../../src/util/shim"

test("isShim only recognises Windows cmd/bat launchers", () => {
  expect(isShim("C:\\tools\\code.cmd", "win32")).toBe(true)
  expect(isShim("C:\\tools\\code.BAT", "win32")).toBe(true)
  expect(isShim("C:\\tools\\code.exe", "win32")).toBe(false)
  expect(isShim("/tools/code.cmd", "linux")).toBe(false)
})

test("quote wraps metacharacters so cmd cannot split the command", () => {
  for (const arg of ["a&b", "a|b", "a>b", "a<b", "a^b", "a b"]) expect(quote(arg)).toBe(`"${arg}"`)
})

test("quote refuses characters it cannot neutralise", () => {
  for (const arg of ['a"b', "a%b", "a\rb", "a\nb"]) expect(() => quote(arg)).toThrow(/cannot be quoted safely/)
})
