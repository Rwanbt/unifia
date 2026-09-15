/* SPDX-License-Identifier: MIT */

import type { DesignNodeV1, DesignPointV1 } from "../model/schema"

export type DesignTool = "select" | "rectangle" | "ellipse" | "line" | "pen"

export const designTools: readonly DesignTool[] = ["select", "rectangle", "ellipse", "line", "pen"]

/** A click without a drag must not create a degenerate node. */
export const designDraftMinSize = 4

export type DesignDraftRect = { x: number; y: number; width: number; height: number }

export type DesignDraft =
  | { kind: "rectangle"; rect: DesignDraftRect }
  | { kind: "ellipse"; rect: DesignDraftRect }
  | { kind: "line"; start: DesignPointV1; end: DesignPointV1 }
  | { kind: "path"; points: readonly DesignPointV1[] }

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
      if (draft.points.length < 2) return undefined
      const xs = draft.points.map((point) => point.x)
      const ys = draft.points.map((point) => point.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const d = draft.points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x - minX} ${point.y - minY}`)
        .join(" ")
      return {
        ...base,
        name: "Path",
        type: "path",
        transform: { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, rotation: 0 },
        d,
      }
    }
  }
}
