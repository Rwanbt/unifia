// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test"
import { quoteArg } from "../../../src/cli/cmd/quote-arg"
import { expand } from "../../../src/session/command-template"

describe("quoteArg", () => {
  test("leaves arguments without spaces untouched", () => {
    expect(quoteArg("plain")).toBe("plain")
  })

  test("reads back spaced arguments as one argument", () => {
    const args = ["two words", "second arg"]
    // $1 is not the last placeholder here, so it is a single argument; $2 would absorb the rest
    expect(expand("$1|$2", args.map(quoteArg).join(" "))).toBe("two words|second arg")
  })

  test("carries a double quote inside single quotes", () => {
    expect(quoteArg('say "hi" now')).toBe(`'say "hi" now'`)
    expect(expand("$1|$2", `${quoteArg('say "hi" now')} ${quoteArg("next one")}`)).toBe('say "hi" now|next one')
  })

  test("carries a single quote inside double quotes", () => {
    expect(quoteArg("it's here")).toBe(`"it's here"`)
    expect(expand("$1|$2", `${quoteArg("it's here")} ${quoteArg("next one")}`)).toBe("it's here|next one")
  })

  test("does not rewrite backslashes", () => {
    expect(quoteArg("C:\\Users\\me file")).toBe('"C:\\Users\\me file"')
    expect(expand("$1|$2", `${quoteArg("C:\\Users\\me file")} ${quoteArg("next one")}`)).toBe(
      "C:\\Users\\me file|next one",
    )
  })

  test("returns an argument with both quote kinds unchanged", () => {
    expect(quoteArg(`a "b" 'c' d`)).toBe(`a "b" 'c' d`)
  })

  test("round-trips several arguments through the tokenizer", () => {
    expect(expand("$1|$2|$3", ["a b", "c", "d e"].map(quoteArg).join(" "))).toBe("a b|c|d e")
  })
})
