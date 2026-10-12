/* SPDX-License-Identifier: MIT */

// CodeQL js/polynomial-redos: a node id made of `{` with no `}` rescanned to
// the end of the id for every brace.
import { describe, expect, test } from "bun:test"
import { DYNAMIC_NODE_ID_PATTERN } from "../src/workflow-graph"

describe("DYNAMIC_NODE_ID_PATTERN", () => {
  test("recognises a dynamic segment", () => {
    expect(DYNAMIC_NODE_ID_PATTERN.test("branch-{index}")).toBe(true)
    expect(DYNAMIC_NODE_ID_PATTERN.test("branch-1")).toBe(false)
  })

  test("a long id of opening braces is rejected in linear time", () => {
    const start = performance.now()
    expect(DYNAMIC_NODE_ID_PATTERN.test("{".repeat(200_000))).toBe(false)
    expect(performance.now() - start).toBeLessThan(750)
  })
})
