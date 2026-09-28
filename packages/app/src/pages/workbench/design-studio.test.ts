/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ADR-085 - the Design studio is not renderable in this package's test setup
// (Konva loads lazily in a real browser), so its contract is pinned at the
// source level: real controls drive the canonical document, engine-less ones
// stay disabled and labelled, and phones get the drawer layout.

const read = (file: string) => readFileSync(resolve(import.meta.dir, file), "utf8")
const tab = read("design-canvas-tab.tsx")
const panel = read("design/runtime/studio-panel.tsx")
const dock = read("design/runtime/studio-dock.tsx")
const canvas = read("design/runtime/design-canvas.tsx")

describe("Design studio (ADR-085)", () => {
  test("the zoom pill drives the canvas through a controlled viewport", () => {
    expect(canvas).toMatch(/const viewport = \(\) => props\.viewport \?\? ownViewport\(\)/)
    expect(tab).toMatch(/viewport=\{viewport\(\)\}\s+onViewport=\{setViewport\}/)
    expect(tab).toMatch(/zoomAt\(current, factor, \{ x: width \/ 2, y: height \/ 2 \}\)/)
  })

  test("checkpoint and revert restore a local document snapshot", () => {
    expect(tab).toMatch(/const takeCheckpoint = \(\) => \{\s+setCheckpoint\(document\(\)\)/)
    expect(tab).toMatch(/replaceDocument\(checkpoint\(\)\)/)
    expect(tab).toMatch(/canRevert=\{document\(\) !== checkpoint\(\)\}/)
  })

  test("the dock keeps the canonical tool hooks and marks engine-less tools", () => {
    expect(dock).toMatch(/data-design-tool=\{entry\.kind === "tool" \? entry\.tool : undefined\}/)
    expect(dock).toMatch(/aria-disabled=\{entry\.kind === "pending" \? "true" : undefined\}/)
    expect(panel).toMatch(/data-design-tool="comment"/)
  })

  test("engine-less panel tools are disabled and labelled, never faked", () => {
    expect(panel).toMatch(/const Pending = /)
    expect(panel).toMatch(/aria-disabled="true" title=\{soon\(item\.label\)\}/)
    expect(panel).not.toMatch(/onClick=\{\(\) => \{\s*\}\}/)
  })

  test("phones open the panel as a drawer from the bottom bar", () => {
    expect(tab).toMatch(/data-drawer-open=\{narrow\(\) && drawerOpen\(\) \? "" : undefined\}/)
    expect(tab).toMatch(/data-design-studio-layers-toggle/)
    expect(tab).toMatch(/data-design-studio-scrim/)
  })
})
