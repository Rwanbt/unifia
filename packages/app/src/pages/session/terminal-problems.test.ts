/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { problemRows } from "./terminal-problem-rows"

const at = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 1 } })

describe("Terminal Problems rows (#680)", () => {
  test("errors come first, then by path and position, with one-based lines and relative paths", () => {
    const rows = problemRows(
      {
        "/work/repo/src/b.ts": [{ range: at(4, 2), severity: 2, message: "unused", source: "ts" }],
        "/work/repo/src/a.ts": [
          { range: at(9, 0), severity: 1, message: "late error" },
          { range: at(1, 6), severity: 1, message: "early error" },
        ],
      },
      "/work/repo",
    )
    expect(rows.map((row) => [row.severity, row.path, row.line, row.column, row.message])).toEqual([
      ["error", "src/a.ts", 2, 7, "early error"],
      ["error", "src/a.ts", 10, 1, "late error"],
      ["warning", "src/b.ts", 5, 3, "unused"],
    ])
  })

  test("a diagnostic without severity is shown as info", () => {
    expect(problemRows({ "/r/x.ts": [{ range: at(0, 0), message: "hint" }] }, "/r")[0]?.severity).toBe("info")
  })
})
