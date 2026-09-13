/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// C-PRE1-01 phase 8 (Automate studio canvas) — static smoke test.
//
// The SolidJS component cannot be imported in plain Node (the router
// is client-only). We pin its shape against the source so a future
// refactor that drops the pan/zoom wiring, the arrow marker, or the
// screen-reader fallback breaks this test, which is the point.

const SOURCE = resolve(import.meta.dir, "automate-studio-canvas.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("AutomateStudioCanvas smoke test (static)", () => {
  test("exports the SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateStudioCanvas\s*\(/)
  })

  test("delegates layout to the pure helper", () => {
    expect(source).toMatch(/from\s+["']\.\/automate-graph-layout["']/)
    expect(source).toMatch(/layoutWorkflowSteps\(/)
  })

  test("renders an SVG with a viewport and a zoom-able inner group", () => {
    expect(source).toMatch(/<svg[\s\S]*role="img"/)
    expect(source).toMatch(/viewBox=/)
    expect(source).toMatch(/scale\(\$\{zoom\(\)\}\)/)
  })

  test("wires Ctrl/Cmd + wheel for zoom (anti-regression)", () => {
    expect(source).toMatch(/event\.ctrlKey\s*\|\|\s*event\.metaKey/)
    expect(source).toMatch(/event\.preventDefault\(\)/)
  })

  test("uses pointer events for pan drag", () => {
    expect(source).toMatch(/onPointerDown=/)
    expect(source).toMatch(/onPointerMove=/)
    expect(source).toMatch(/onPointerUp=/)
  })

  test("renders arrow markers on edges", () => {
    expect(source).toMatch(/marker-end=/)
    expect(source).toMatch(/<marker[\s\S]*id="automate-arrowhead"/)
  })

  test("falls back to a screen-reader list for accessibility", () => {
    expect(source).toMatch(/class="sr-only"/)
    expect(source).toMatch(/aria-label=/)
  })

  test("marks approval-required nodes via data attributes", () => {
    expect(source).toMatch(/data-automate-studio-node-approval=/)
  })
})
