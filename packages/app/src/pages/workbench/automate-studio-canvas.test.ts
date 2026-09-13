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

  test("exposes a controlled-selection API (selectedNodeId + onSelectNode)", () => {
    // Slice 2: selection is parent-owned so the canvas and the
    // inspector pane share one source of truth. The canvas must NOT
    // call setSelectedNodeId internally anymore.
    expect(source).toMatch(/readonly\s+selectedNodeId\?:\s*string/)
    expect(source).toMatch(/readonly\s+onSelectNode\?:\s*\(nodeId:\s*string\s*\|\s*undefined\)/)
    expect(source).not.toMatch(/createSignal<string\s*\|\s*undefined>\(\)/)
  })

  test("exposes a controlled-positions API (positions + onPositionsChange)", () => {
    // Slice 3: drag-to-move positions are parent-owned too, so the
    // canvas and the inspector pane share the same coordinates. The
    // canvas reads from `positions` and emits `onPositionsChange` on
    // every drag update.
    expect(source).toMatch(/readonly\s+positions\?:\s*Readonly<Record<string,\s*NodePositionOverride>>/)
    expect(source).toMatch(/readonly\s+onPositionsChange\?:\s*\(positions:\s*Record<string,\s*NodePositionOverride>\)\s*=>\s*void/)
  })

  test("renders a zoom-to-fit button that calls computeZoomToFit (slice 9)", () => {
    // Anti-regression: a future refactor that drops the zoom-to-fit
    // wiring would leave the user with no way to recover when they
    // pan off-canvas and lose the graph.
    expect(source).toMatch(/function\s+onZoomToFit/)
    expect(source).toMatch(/aria-label=\{t\("workbench\.automate\.canvas\.zoomToFit"\)\}/)
  })

  test("embeds the minimap at the bottom-right corner (slice 9)", () => {
    expect(source).toMatch(/data-automate-studio-minimap-wrapper/)
    expect(source).toMatch(/AutomateStudioMinimap\s+/)
  })

  test("wires drag-to-move via NodeRect onPointerDown", () => {
    // Each node group must start a drag on pointerdown so the canvas
    // can track the cursor and emit position updates. The handler is
    // `startNodeDrag` and the canvas splits pan and node drags via
    // two separate signals.
    expect(source).toMatch(/function\s+startNodeDrag/)
    expect(source).toMatch(/onPointerDown=\{props\.onPointerDown\}/)
    expect(source).toMatch(/nodeDragging/)
  })

  test("divides screen drag deltas by zoom so nodes track the cursor", () => {
    // Anti-regression: a future refactor that forgets the /zoom factor
    // would make nodes drift faster or slower than the cursor.
    expect(source).toMatch(/\(event\.clientX\s*-\s*nodeDrag\.startClientX\)\s*\/\s*scale/)
    expect(source).toMatch(/\(event\.clientY\s*-\s*nodeDrag\.startClientY\)\s*\/\s*scale/)
  })

  test("follows the user drag for edges too (no layout snap-back)", () => {
    // Slice 3+4: when a node is dragged, its outgoing + incoming
    // edges must follow. The canvas re-derives endpoints from the
    // override map + user edges on every render.
    expect(source).toMatch(/mergeEndpoints\(graph\(\),\s*overrides\(\),\s*userEdges\(\)\)/)
  })

  test("exposes per-node x/y as data attributes for the Inspector", () => {
    expect(source).toMatch(/data-automate-studio-node-x=/)
    expect(source).toMatch(/data-automate-studio-node-y=/)
  })

  test("exposes a controlled-edges API (edges + onEdgesChange) for slice 4", () => {
    // Same controlled shape as `positions`. The canvas merges
    // synthetic sequential edges with user-added edges and commits
    // additions/removals through `onEdgesChange`.
    expect(source).toMatch(/readonly\s+edges\?:\s*readonly\s+UserEdge\[\]/)
    expect(source).toMatch(/readonly\s+onEdgesChange\?:\s*\(edges:\s*readonly\s*UserEdge\[\]\)\s*=>\s*void/)
  })

  test("renders one input port + one output port per node", () => {
    // The data-attr template is `data-automate-studio-port="${id}:in|out"`.
    expect(source).toMatch(/data-automate-studio-port=\{`\$\{props\.node\.id\}:in`\}/)
    expect(source).toMatch(/data-automate-studio-port=\{`\$\{props\.node\.id\}:out`\}/)
  })

  test("starts a port-to-port connection drag from the output port", () => {
    expect(source).toMatch(/function\s+startPortDrag/)
    expect(source).toMatch(/setConnecting\(\{/)
  })

  test("commits a new edge when the user releases near an input port", () => {
    // The canvas calls onEdgesChange with the new edge after
    // hit-testing against the closest input port within
    // PORT_HIT_RADIUS.
    expect(source).toMatch(/hasEdge\(userEdges\(\),\s*conn\.fromNodeId,\s*targetId\)/)
    expect(source).toMatch(/nearestInputPortId\(graph\(\),\s*overrides\(\),\s*graphCoords\.x,\s*graphCoords\.y\)/)
    expect(source).toMatch(/\[\.\.\.userEdges\(\),\s*\{\s*from:\s*conn\.fromNodeId,\s*to:\s*targetId\s*\}\]/)
  })

  test("renders a ghost edge while the user is dragging a connection", () => {
    expect(source).toMatch(/data-automate-studio-ghost-edge/)
  })

  test("lets the user delete a user edge by clicking it", () => {
    // The path element for user edges carries
    // data-automate-studio-edge-user="true" and an onClick that
    // filters the edge out via onEdgesChange.
    expect(source).toMatch(/data-automate-studio-edge-user=/)
  })

  test("converts client coordinates to graph coordinates for hit-testing", () => {
    // The conversion must account for the SVG bounding rect, the
    // current pan, and the zoom.
    expect(source).toMatch(/function\s+clientToGraphCoords/)
    expect(source).toMatch(/rect\.left\s*-\s*panX\(\)/)
  })
})
