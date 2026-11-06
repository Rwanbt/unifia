/* SPDX-License-Identifier: MIT */
// The app sends project-relative paths to the LSP routes; pathToFileURL alone
// resolved them against the server's cwd and every lookup came back empty.
import { describe, expect, test } from "bun:test"
import { inProject } from "../../src/server/routes/lsp"

describe("LSP routes resolve files against the project", () => {
  test("a relative path lands inside the project directory", () => {
    expect(inProject({ file: "src/app.ts", line: 1 }, "/work/repo")).toEqual({ file: "/work/repo/src/app.ts", line: 1 })
  })

  test("an absolute path is kept", () => {
    expect(inProject({ file: "/other/app.ts" }, "/work/repo").file).toBe("/other/app.ts")
  })
})
