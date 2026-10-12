/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { splitCommand } from "../../script/cargo-proxy-argv.mjs"

test("splitCommand_PlainCommand_SplitsOnWhitespace", () => {
  expect(splitCommand("cargo  build --release")).toEqual(["cargo", "build", "--release"])
})

test("splitCommand_QuotedArgument_StaysOneToken", () => {
  expect(splitCommand(`cargo test -- "two words" 'and more'`)).toEqual(["cargo", "test", "--", "two words", "and more"])
})

test("splitCommand_EmptyQuotes_KeepAnEmptyArgument", () => {
  expect(splitCommand(`npm run x ""`)).toEqual(["npm", "run", "x", ""])
})

test("splitCommand_OpenQuote_ReturnsNothingToRun", () => {
  expect(splitCommand(`cargo test "unterminated`)).toEqual([])
})

test("splitCommand_EqualsSign_IsKeptInsideTheToken", () => {
  expect(splitCommand("npm run build --workspace=x")).toEqual(["npm", "run", "build", "--workspace=x"])
})
