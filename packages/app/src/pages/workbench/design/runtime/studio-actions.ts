/* SPDX-License-Identifier: MIT */

import { inspectDesignDocument } from "../model/validation"
import { pathBounds, serializePath, translatePath, type PathData, type PathSegment } from "../model/path"
import type { DesignDocumentV1, DesignNodeId, DesignNodeV1, FrameNodeV1, PathNodeV1 } from "../model/schema"
import type { DesignPoint } from "./geometry"

/**
 * Pure logic behind the studio's action buttons (ADR-085 amendment, owner
 * directive 2026-11-03): no Solid, no Konva, so every rule is unit-tested and
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

// ---- Audit ------------------------------------------------------------------

export type DesignAuditFinding = {
  severity: "error" | "warning"
  code: "invalid-document" | "low-contrast" | "hidden" | "unnamed" | "empty-text" | "off-page" | "tiny"
  nodeId?: DesignNodeId
  detail?: string
}

function hexToRgb(color: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return undefined
  const hex = match[1]!.length === 3 ? match[1]!.replace(/./g, (c) => c + c) : match[1]!
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio, or undefined when a colour is not plain hex. */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const a = hexToRgb(foreground)
  const b = hexToRgb(background)
  if (!a || !b) return undefined
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const overlaps = (a: DesignNodeV1["transform"], b: DesignNodeV1["transform"]) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The top-most filled shape under a node's centre, drawn before it. */
function backgroundFill(document: DesignDocumentV1, node: DesignNodeV1): string | undefined {
  const order = document.rootIds
  const index = order.indexOf(node.id)
  for (let at = (index < 0 ? order.length : index) - 1; at >= 0; at--) {
    const below = document.nodes[order[at]!]
    if (!below || !below.visible || !overlaps(below.transform, node.transform)) continue
    if (below.type === "frame") return "#ffffff"
    if ("style" in below && below.style?.fill) return below.style.fill
  }
  return "#ffffff"
}

/** Minimum size (px) a shape needs to be tappable / readable. */
const TINY_PX = 4

/**
 * Checks a document the way a reviewer would before hand-off: it parses, text
 * is readable (WCAG AA 4.5:1 against what is under it), nothing is accidentally
 * hidden, unnamed, empty, microscopic or lost outside every page.
 */
export function auditDesignDocument(document: DesignDocumentV1): DesignAuditFinding[] {
  const findings: DesignAuditFinding[] = []
  const inspection = inspectDesignDocument(document)
  if (!inspection.ok) findings.push({ severity: "error", code: "invalid-document", detail: inspection.issues[0] })
  const pages = designPages(document)
  for (const node of Object.values(document.nodes)) {
    if (!node.visible) findings.push({ severity: "warning", code: "hidden", nodeId: node.id })
    if (node.name.trim() === "") findings.push({ severity: "warning", code: "unnamed", nodeId: node.id })
    if (node.type === "text") {
      if (node.text.trim() === "") findings.push({ severity: "warning", code: "empty-text", nodeId: node.id })
      const ratio = contrastRatio(node.style?.fill ?? "#18181b", backgroundFill(document, node) ?? "#ffffff")
      if (ratio !== undefined && ratio < 4.5) {
        findings.push({ severity: "error", code: "low-contrast", nodeId: node.id, detail: ratio.toFixed(2) })
      }
    }
    if (node.type !== "line" && node.type !== "frame" && (node.transform.width < TINY_PX || node.transform.height < TINY_PX)) {
      findings.push({ severity: "warning", code: "tiny", nodeId: node.id })
    }
    if (pages.length > 0 && node.parentId === null && node.type !== "frame" && !pages.some((page) => overlaps(page.transform, node.transform))) {
      findings.push({ severity: "warning", code: "off-page", nodeId: node.id })
    }
  }
  return findings
}
