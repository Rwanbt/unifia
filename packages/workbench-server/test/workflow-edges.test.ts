/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "vitest"
import { hasValidEdges } from "../src/workflow-edges.js"
import type { WorkflowDefinitionPort } from "../src/workflow-port.js"

const definition = (edges: unknown): WorkflowDefinitionPort =>
  ({
    id: "wf",
    version: 1,
    workspaceId: "ws",
    steps: [
      { id: "a", capability: "workspace.read", input: {} },
      { id: "b", capability: "workspace.read", input: {} },
    ],
    edges,
  }) as WorkflowDefinitionPort

describe("hasValidEdges", () => {
  it("accepts a definition without edges (the legacy linear chain)", () => {
    expect(hasValidEdges(definition(undefined))).toBe(true)
  })

  it("accepts edges between existing steps, with or without a kind", () => {
    expect(hasValidEdges(definition([{ from: "a", to: "b" }, { from: "a", to: "b", kind: "branch-true" }]))).toBe(true)
  })

  it("refuses an edge that touches an unknown step", () => {
    expect(hasValidEdges(definition([{ from: "a", to: "ghost" }]))).toBe(false)
  })

  it("refuses a self loop, an unknown kind and malformed edges", () => {
    expect(hasValidEdges(definition([{ from: "a", to: "a" }]))).toBe(false)
    expect(hasValidEdges(definition([{ from: "a", to: "b", kind: "teleport" }]))).toBe(false)
    expect(hasValidEdges(definition("a-to-b"))).toBe(false)
    expect(hasValidEdges(definition([null]))).toBe(false)
  })
})
