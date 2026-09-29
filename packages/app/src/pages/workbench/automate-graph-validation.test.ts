/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { validateGraphEdges } from "./automate-graph-validation"

const ifNode = { id: "check", family: "control.if" }
const toolNode = { id: "fetch", family: "tool.http" }
const endNode = { id: "done", family: "tool.transform" }

describe("validateGraphEdges", () => {
  test("returns no issue for a clean sequential graph", () => {
    const issues = validateGraphEdges(
      [toolNode, endNode],
      [
        { from: "fetch", to: "done" },
        { from: "fetch", to: "done", kind: "flow" },
      ],
    )
    expect(issues).toEqual([])
  })

  test("detects a two-node cycle with a stable path", () => {
    const issues = validateGraphEdges(
      [toolNode, endNode],
      [
        { from: "fetch", to: "done" },
        { from: "done", to: "fetch" },
      ],
    )
    expect(issues).toEqual([{ code: "cycle", path: ["fetch", "done", "fetch"] }])
  })

  test("detects a self-loop", () => {
    const issues = validateGraphEdges([toolNode], [{ from: "fetch", to: "fetch" }])
    expect(issues).toEqual([{ code: "cycle", path: ["fetch", "fetch"] }])
  })

  test("accepts both branch kinds out of a control.if node", () => {
    const issues = validateGraphEdges(
      [ifNode, toolNode, endNode],
      [
        { from: "check", to: "fetch", kind: "branch-true" },
        { from: "check", to: "done", kind: "branch-false" },
      ],
    )
    expect(issues).toEqual([])
  })

  test("flags a duplicated branch kind out of one node", () => {
    const issues = validateGraphEdges(
      [ifNode, toolNode, endNode],
      [
        { from: "check", to: "fetch", kind: "branch-true" },
        { from: "check", to: "done", kind: "branch-true" },
      ],
    )
    expect(issues).toEqual([{ code: "duplicate-branch", from: "check", kind: "branch-true" }])
  })

  test("flags a branch edge out of a non-branching family", () => {
    const issues = validateGraphEdges(
      [toolNode, endNode],
      [{ from: "fetch", to: "done", kind: "branch-false" }],
    )
    expect(issues).toEqual([{ code: "branch-from-non-branching", from: "fetch", kind: "branch-false" }])
  })

  test("does not flag branch edges out of an unknown node id", () => {
    const issues = validateGraphEdges([], [{ from: "ghost", to: "done", kind: "branch-true" }])
    expect(issues).toEqual([])
  })

  test("reports the cycle before branch issues in deterministic order", () => {
    const issues = validateGraphEdges(
      [ifNode, toolNode, endNode],
      [
        { from: "check", to: "fetch", kind: "branch-true" },
        { from: "check", to: "done", kind: "branch-true" },
        { from: "fetch", to: "check", kind: "branch-false" },
      ],
    )
    expect(issues.map((issue) => issue.code)).toEqual([
      "cycle",
      "duplicate-branch",
      "branch-from-non-branching",
    ])
  })
})