/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// C-PRE1-01 phase 8 slice 2 — static smoke test for the inspector.
//
// The SolidJS component cannot be imported in plain Node (the router
// is client-only). We pin its shape against the source so a future
// refactor that drops the empty-state fallback, the approval flag
// rendering, or the data-attribute hooks breaks this test.

const SOURCE = resolve(import.meta.dir, "automate-studio-inspector.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("AutomateStudioInspector smoke test (static)", () => {
  test("exports the SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateStudioInspector\s*\(/)
  })

  test("renders an empty state when no node is selected", () => {
    expect(source).toMatch(/data-automate-studio-inspector="empty"/)
    expect(source).toMatch(/workbench\.automate\.inspector\.empty/)
  })

  test("renders the selected node id via a data attribute (parent hook)", () => {
    expect(source).toMatch(/data-automate-studio-inspector-id=/)
  })

  test("renders the position summary as 'step N of M'", () => {
    expect(source).toMatch(/workbench\.automate\.inspector\.positionValue/)
    expect(source).toMatch(/data-automate-studio-inspector-position/)
  })

  test("renders the approval badge with a data-attribute hook", () => {
    expect(source).toMatch(/data-automate-studio-inspector-approval="true"/)
    expect(source).toMatch(/workbench\.automate\.inspector\.approvalYes/)
    expect(source).toMatch(/workbench\.automate\.inspector\.approvalNo/)
  })

  test("exposes a close button when onClose is provided", () => {
    expect(source).toMatch(/aria-label=\{t\("workbench\.automate\.inspector\.close"\)\}/)
  })

  test("renders a Coordinates section when x/y are provided", () => {
    // Slice 3: drag-to-move surfaces the effective coordinates here
    // so the user sees where the node currently sits in the canvas.
    expect(source).toMatch(/data-automate-studio-inspector-coordinates/)
    expect(source).toMatch(/workbench\.automate\.inspector\.coordinatesValue/)
  })

  test("shows a badge when the position has been overridden by drag", () => {
    expect(source).toMatch(/workbench\.automate\.inspector\.coordinatesOverridden/)
  })

  test("renders an Edges section listing outgoing + incoming connections", () => {
    // Slice 4: the inspector surfaces the user-drawn connections from
    // the canvas so the user can see which nodes their selected
    // node connects to / from.
    expect(source).toMatch(/data-automate-studio-inspector-edges-out/)
    expect(source).toMatch(/data-automate-studio-inspector-edges-in/)
    expect(source).toMatch(/data-automate-studio-inspector-edge-out=/)
    expect(source).toMatch(/data-automate-studio-inspector-edge-in=/)
  })

  test("shows the total user-added edge count for the workflow", () => {
    expect(source).toMatch(/data-automate-studio-inspector-user-edge-count/)
    expect(source).toMatch(/workbench\.automate\.inspector\.userEdgeCount/)
  })
})
