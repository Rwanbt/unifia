/* SPDX-License-Identifier: MIT */
// The app sends project-relative paths to the LSP routes; pathToFileURL alone
// resolved them against the server's cwd and every lookup came back empty.
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { inProject } from "../../src/server/routes/lsp"

describe("LSP routes resolve files against the project", () => {
  test("a relative path lands inside the project directory", () => {
    // path.resolve, not a literal: on Windows the project root carries a drive letter.
    const root = path.resolve("/work/repo")
    expect(inProject({ file: "src/app.ts", line: 1 }, root)).toEqual({ file: path.join(root, "src", "app.ts"), line: 1 })
  })

  test("an absolute path is kept", () => {
    const absolute = path.resolve("/other/app.ts")
    expect(inProject({ file: absolute }, path.resolve("/work/repo")).file).toBe(absolute)
  })
})
