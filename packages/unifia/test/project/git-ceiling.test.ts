/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import path from "node:path"
import { gitCeilingStop } from "../../src/project/git-ceiling"

const root = path.resolve("/ceiling-test")
const ceiling = path.join(root, "tmp")

describe("gitCeilingStop", () => {
  test("no ceiling configured: the walk is unbounded", () => {
    expect(gitCeilingStop(path.join(ceiling, "a", "b"), undefined)).toBeUndefined()
    expect(gitCeilingStop(path.join(ceiling, "a", "b"), "")).toBeUndefined()
  })

  test("stops at the child of the ceiling, never inspecting the ceiling itself", () => {
    expect(gitCeilingStop(path.join(ceiling, "a", "b"), ceiling)).toBe(path.join(ceiling, "a"))
    expect(gitCeilingStop(path.join(ceiling, "a"), ceiling)).toBe(path.join(ceiling, "a"))
  })

  test("a ceiling that is not an ancestor does not bound the walk", () => {
    expect(gitCeilingStop(path.join(root, "other", "x"), ceiling)).toBeUndefined()
    expect(gitCeilingStop(ceiling, ceiling)).toBeUndefined()
  })

  test("uses the nearest of several ceilings, ignoring trailing separators", () => {
    const inner = path.join(ceiling, "a")
    const list = [ceiling + path.sep, inner].join(path.delimiter)
    expect(gitCeilingStop(path.join(inner, "b", "c"), list)).toBe(path.join(inner, "b"))
  })

  test("Windows paths compare case-insensitively", () => {
    expect(gitCeilingStop(path.join(ceiling, "a", "b"), ceiling.toUpperCase(), "win32")).toBe(path.join(ceiling, "a"))
    expect(gitCeilingStop(path.join(ceiling, "a", "b"), ceiling.toUpperCase(), "linux")).toBeUndefined()
  })
})
