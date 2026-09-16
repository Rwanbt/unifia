/* SPDX-License-Identifier: MIT */

import { pathBounds, serializePath, translatePath, type PathData, type PathSegment } from "../model/path"
import type { DesignNodeV1, DesignPointV1 } from "../model/schema"

export type DesignTool = "select" | "rectangle" | "ellipse" | "line" | "pen"

export const designTools: readonly DesignTool[] = ["select", "rectangle", "ellipse", "line", "pen"]

/** A click without a drag must not create a degenerate node. */
export const designDraftMinSize = 4

export type DesignDraftRect = { x: number; y: number; width: number; height: number }

/**
 * A pen point with optional Bezier handles, relative to the point. A
 * click-drag leaves opposite handles (`handleOut = delta`, `handleIn = -delta`)
 * so the tangent is symmetric, exactly like the mockup's pen.
 */
export type DesignPenPoint = {
  x: number
  y: number
  handleIn?: DesignPointV1
  handleOut?: DesignPointV1
}

export type DesignDraft =
  | { kind: "rectangle"; rect: DesignDraftRect }
  | { kind: "ellipse"; rect: DesignDraftRect }
  | { kind: "line"; start: DesignPointV1; end: DesignPointV1 }
  | { kind: "path"; points: readonly DesignPenPoint[] }

export function draftRect(start: DesignPointV1, end: DesignPointV1): DesignDraftRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function isDraftUsable(draft: DesignDraft): boolean {
  switch (draft.kind) {
    case "rectangle":
    case "ellipse":
      return draft.rect.width >= designDraftMinSize || draft.rect.height >= designDraftMinSize
    case "line":
      return Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) >= designDraftMinSize
    case "path":
      return draft.points.length >= 2
  }
}

/**
 * Builds the canonical path data for a pen draft. A segment is cubic as soon
 * as either end carries a handle (missing handles collapse to their anchor),
 * a line otherwise. Closing a path appends the start point as a final
 * explicit segment instead of emitting `Z`: the editable subset stays a
 * single M/L/C/Q chain, and the parser keeps refusing `Z` on purpose.
 */
export function penPathData(points: readonly DesignPenPoint[]): PathData | undefined {
  const first = points[0]
  if (!first || points.length < 2) return undefined
  const segments: PathSegment[] = []
  let from = first
  for (const point of points.slice(1)) {
    const control1 = from.handleOut ? { x: from.x + from.handleOut.x, y: from.y + from.handleOut.y } : undefined
    const control2 = point.handleIn ? { x: point.x + point.handleIn.x, y: point.y + point.handleIn.y } : undefined
    if (control1 || control2) {
      segments.push({
        kind: "cubic",
        control1: control1 ?? { x: from.x, y: from.y },
        control2: control2 ?? { x: point.x, y: point.y },
        to: { x: point.x, y: point.y },
      })
    } else {
      segments.push({ kind: "line", to: { x: point.x, y: point.y } })
    }
    from = point
  }
  return { start: { x: first.x, y: first.y }, segments }
}

/**
 * Maps a finished draft to a canonical node. The caller owns the id (document
 * identity is not the tool's concern) and the node goes through the normal
 * `insertNode` command, so a drawn shape is one history entry like any other
 * gesture.
 */
export function draftToNode(draft: DesignDraft, id: string): DesignNodeV1 | undefined {
  const base = { id, parentId: null, visible: true, locked: false }
  switch (draft.kind) {
    case "rectangle":
      return { ...base, name: "Rectangle", type: "rectangle", transform: { ...draft.rect, rotation: 0 } }
    case "ellipse":
      return { ...base, name: "Ellipse", type: "ellipse", transform: { ...draft.rect, rotation: 0 } }
    case "line": {
      const dx = draft.end.x - draft.start.x
      const dy = draft.end.y - draft.start.y
      return {
        ...base,
        name: "Line",
        type: "line",
        transform: { x: draft.start.x, y: draft.start.y, width: Math.abs(dx), height: Math.abs(dy), rotation: 0 },
        points: [
          { x: 0, y: 0 },
          { x: dx, y: dy },
        ],
      }
    }
    case "path": {
      const data = penPathData(draft.points)
      if (!data) return undefined
      const bounds = pathBounds(data)
      if (!bounds) return undefined
      return {
        ...base,
        name: "Path",
        type: "path",
        transform: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, rotation: 0 },
        d: serializePath(translatePath(data, { x: -bounds.x, y: -bounds.y })),
      }
    }
  }
}
