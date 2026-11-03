/* SPDX-License-Identifier: MIT */

import { pathBounds, serializePath, translatePath, type PathData, type PathSegment } from "../model/path"
import type { DesignDocumentV1, DesignNodeId, DesignNodeV1, FrameNodeV1, PathNodeV1 } from "../model/schema"
import type { DesignPoint } from "./geometry"

/**
 * Pure logic behind the studio's action buttons (owner directive
 * 2026-11-03, implementing the controls ADR-085 left unavailable): no Solid, no Konva, so every rule is unit-tested and
 * the canvas tab only wires results into typed commands.
 */

// ---- Vector: convert a primitive into an editable path ---------------------

/** Cubic-Bezier circle constant: control distance = radius × κ. */
const KAPPA = 0.5522847498

/**
 * Converts a rectangle, ellipse or line into a path node with the same id,
 * name, transform and style, so it can be edited anchor by anchor. Path data
 * is local to the transform origin, like every path in the document.
 */
export function shapeToPath(node: DesignNodeV1): PathNodeV1 | undefined {
  const { width: w, height: h } = node.transform
  let data: PathData | undefined
  let style: PathNodeV1["style"]
  if (node.type === "rectangle") {
    data = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: "line", to: { x: w, y: 0 } },
        { kind: "line", to: { x: w, y: h } },
        { kind: "line", to: { x: 0, y: h } },
        { kind: "line", to: { x: 0, y: 0 } },
      ],
    }
    style = node.style
  } else if (node.type === "ellipse") {
    const rx = w / 2
    const ry = h / 2
    const kx = rx * KAPPA
    const ky = ry * KAPPA
    const quarter = (from: DesignPoint, c1: DesignPoint, c2: DesignPoint, to: DesignPoint): PathSegment => {
      void from
      return { kind: "cubic", control1: c1, control2: c2, to }
    }
    const top = { x: rx, y: 0 }
    const right = { x: w, y: ry }
    const bottom = { x: rx, y: h }
    const left = { x: 0, y: ry }
    data = {
      start: top,
      segments: [
        quarter(top, { x: rx + kx, y: 0 }, { x: w, y: ry - ky }, right),
        quarter(right, { x: w, y: ry + ky }, { x: rx + kx, y: h }, bottom),
        quarter(bottom, { x: rx - kx, y: h }, { x: 0, y: ry + ky }, left),
        quarter(left, { x: 0, y: ry - ky }, { x: rx - kx, y: 0 }, top),
      ],
    }
    style = node.style
  } else if (node.type === "line") {
    const [first, ...rest] = node.points
    if (!first || rest.length === 0) return undefined
    data = { start: first, segments: rest.map((to) => ({ kind: "line", to })) }
    style = { stroke: node.stroke ?? "#18181b", strokeWidth: node.strokeWidth ?? 2 }
  }
  if (!data) return undefined
  return {
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    visible: node.visible,
    locked: node.locked,
    transform: node.transform,
    type: "path",
    d: serializePath(data),
    ...(style ? { style } : {}),
  }
}

// ---- Pencil / annotate: freehand stroke into a path ------------------------

/** Drops points closer than `tolerance` to the previous kept one. */
export function thinPoints(points: readonly DesignPoint[], tolerance: number): DesignPoint[] {
  const kept: DesignPoint[] = []
  for (const point of points) {
    const last = kept[kept.length - 1]
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= tolerance) kept.push(point)
  }
  const end = points[points.length - 1]
  if (end && kept[kept.length - 1] !== end && kept.length > 1) kept[kept.length - 1] = end
  return kept
}

/**
 * Turns a world-space freehand stroke into a path node. The stroke is
 * smoothed with quadratic segments through the midpoints of consecutive
 * samples, the usual way to draw a pen trace without corners.
 */
export function freehandPathNode(
  points: readonly DesignPoint[],
  id: DesignNodeId,
  kind: "pencil" | "annotate",
): PathNodeV1 | undefined {
  const samples = thinPoints(points, 1.5)
  const first = samples[0]
  if (!first || samples.length < 2) return undefined
  const segments: PathSegment[] = []
  for (let index = 1; index < samples.length - 1; index++) {
    const control = samples[index]!
    const next = samples[index + 1]!
    segments.push({ kind: "quad", control, to: { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 } })
  }
  segments.push({ kind: "line", to: samples[samples.length - 1]! })
  const data: PathData = { start: first, segments }
  const bounds = pathBounds(data)
  if (!bounds) return undefined
  return {
    id,
    name: kind === "annotate" ? "Annotation" : "Pencil",
    parentId: null,
    visible: true,
    locked: false,
    type: "path",
    transform: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, rotation: 0 },
    d: serializePath(translatePath(data, { x: -bounds.x, y: -bounds.y })),
    style:
      kind === "annotate"
        ? { stroke: "#e5484d", strokeWidth: 3, opacity: 0.9 }
        : { stroke: "#18181b", strokeWidth: 2 },
  }
}

// ---- Pages (top-level frames) and format presets ---------------------------

export const FORMAT_PRESETS = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "mobile", width: 390, height: 844 },
] as const

export type FormatPresetId = (typeof FORMAT_PRESETS)[number]["id"]

/** Gap between pages laid out side by side. */
const PAGE_GAP = 80

/** A page is a top-level frame (artboard); the document has no other page concept. */
export function designPages(document: DesignDocumentV1): FrameNodeV1[] {
  return document.rootIds
    .map((id) => document.nodes[id])
    .filter((node): node is FrameNodeV1 => node?.type === "frame")
}

/** Right edge of everything drawn at the root, where the next page goes. */
function contentRight(document: DesignDocumentV1): number {
  let right = 0
  for (const id of document.rootIds) {
    const node = document.nodes[id]
    if (node) right = Math.max(right, node.transform.x + node.transform.width)
  }
  return right
}

export function newPageFrame(document: DesignDocumentV1, id: DesignNodeId, preset: FormatPresetId = "desktop"): FrameNodeV1 {
  const size = FORMAT_PRESETS.find((entry) => entry.id === preset) ?? FORMAT_PRESETS[0]
  const count = designPages(document).length
  const x = document.rootIds.length === 0 ? 0 : contentRight(document) + PAGE_GAP
  return {
    id,
    name: `Page ${count + 1}`,
    parentId: null,
    visible: true,
    locked: false,
    type: "frame",
    childIds: [],
    transform: { x, y: 0, width: size.width, height: size.height, rotation: 0 },
  }
}

/** Fresh ids for a node and its whole subtree, as `duplicateNode` expects. */
export function duplicateIds(document: DesignDocumentV1, id: DesignNodeId, makeId: () => string): Record<DesignNodeId, DesignNodeId> {
  const ids: Record<DesignNodeId, DesignNodeId> = {}
  const visit = (current: DesignNodeId) => {
    ids[current] = makeId()
    const node = document.nodes[current]
    if (node && (node.type === "frame" || node.type === "group")) node.childIds.forEach(visit)
  }
  visit(id)
  return ids
}
