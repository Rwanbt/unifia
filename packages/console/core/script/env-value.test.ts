// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { expect, test } from "bun:test"
import { quoteEnvValue, renderEnvFile } from "./env-value"

// Regression cover for CodeQL alerts #2, #3 and #4 (js/incomplete-sanitization)
// in promote-models.ts, pull-models.ts and update-models.ts. The env file those
// scripts hand to `sst secret load` holds a JSON document read back from
// `sst secret list`, so it contains quotes and backslashes by construction.

test("QuoteEnvValue_EscapesQuoteAndBackslashExactlyOnce", () => {
  expect(quoteEnvValue("plain")).toBe('"plain"')
  // A backslash already in the value must not be able to escape the closing quote.
  expect(quoteEnvValue("trailing\\")).toBe('"trailing\\\\"')
  expect(quoteEnvValue('say "hi"')).toBe('"say \\"hi\\""')
  // The pair that was the actual defect: it used to become an early close.
  expect(quoteEnvValue('{"a":"\\"b\\""}')).toBe('"{\\"a\\":\\"\\\\\\"b\\\\\\"\\"}"')
  expect(quoteEnvValue("line\nbreak")).toBe('"line\nbreak"')
})

test("QuoteEnvValue_RoundTripsThroughAQuotedEnvParser", () => {
  // A parser that honours backslash escapes inside double quotes, which is what
  // dotenv-style loaders do. Every value must come back byte-identical, and the
  // number of keys must be unchanged: an early close would have split one line
  // into several.
  const parse = (line: string) => {
    const key = line.slice(0, line.indexOf("="))
    const body = line.slice(line.indexOf("=") + 1)
    if (!body.startsWith('"')) throw new Error("value is not quoted")
    let out = ""
    for (let i = 1; i < body.length; i++) {
      const char = body[i]!
      if (char === '"') {
        if (body[i + 1] !== undefined) throw new Error("value closed early")
        return [key, out] as const
      }
      if (char === "\\") {
        const next = body[++i]
        if (next === undefined) throw new Error("dangling escape")
        out += next === "n" ? "\n" : next === "t" ? "\t" : next
        continue
      }
      out += char
    }
    throw new Error("unterminated value")
  }

  for (const value of [
    "plain",
    "trailing\\",
    'say "hi"',
    '{"key":"value","escaped":"a\\"b"}',
    "\\\\",
    '\\"',
  ]) {
    const [key, parsed] = parse(`ZEN_MODELS1=${quoteEnvValue(value)}`)
    expect(key).toBe("ZEN_MODELS1")
    expect(parsed).toBe(value)
  }
})

test("RenderEnvFile_KeepsOneLinePerEntry", () => {
  const body = renderEnvFile([
    ["ZEN_MODELS1", '{"a":"b"}'],
    ["ZEN_MODELS2", "x\\"],
  ])
  expect(body.split("\n")).toHaveLength(2)
  expect(body).toBe('ZEN_MODELS1="{\\"a\\":\\"b\\"}"\nZEN_MODELS2="x\\\\"')
})
