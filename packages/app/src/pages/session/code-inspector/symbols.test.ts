/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { flattenDocumentSymbols } from "@/utils/lsp-symbols"
import { locationTarget } from "./lsp-location"

describe("Code inspector LSP actions (#679)", () => {
  test("a definition location opens as a project-relative path on a one-based line", () => {
    const location = { uri: "file:///work/repo/src/app.ts", range: { start: { line: 9, character: 4 } } }
    expect(locationTarget(location, "/work/repo")).toEqual({ path: "src/app.ts", line: 10 })
  })

  test("the flat SymbolInformation answer of typescript-language-server is read", () => {
    // Shape measured against the real server for `export function greet`.
    const flat = [
      {
        name: "greet",
        kind: 12,
        location: { uri: "file:///work/repo/a.ts", range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } } },
      },
    ]
    expect(flattenDocumentSymbols(flat)).toEqual([
      { id: "greet-0-0", name: "greet", kind: 12, kindLabel: "Function", line: 0, character: 0, detail: undefined },
    ])
  })

  test("the hierarchical DocumentSymbol answer keeps the name position", () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } }
    const tree = [{ name: "greet", kind: 12, range, selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } } }]
    expect(flattenDocumentSymbols(tree)[0]).toMatchObject({ line: 0, character: 16 })
  })
})
