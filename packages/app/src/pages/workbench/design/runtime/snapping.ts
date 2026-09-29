/* SPDX-License-Identifier: MIT */

import type { DesignDocumentV1, DesignNodeId, DesignNodeV1 } from "../model/schema"

/** Screen-pixel threshold; the adapter converts it to world units per zoom. */
export const designSnapThresholdPx = 8

export type DesignSnapRect = { x: number; y: number; width: number; height: number }
export type DesignSnapGuide = { axis: "x" | "y"; position: number }
export type DesignSnapResult = { x: number; y: number; guides: readonly DesignSnapGuide[] }

/**
 * Snaps a rectangle's edges (start, centre, end) to the same lines of every
 * candidate and returns the applied offset plus the guide lines to draw.
 * Guides are transient editor state and never reach the document (ADR-039
 * section 9).
 */
export function snapRect(
  rect: DesignSnapRect,
  candidates: readonly DesignSnapRect[],
  threshold: number,
): DesignSnapResult {
  const x = snapAxis("x", lines(rect.x, rect.width), candidates.map((candidate) => lines(candidate.x, candidate.width)), threshold)
  const y = snapAxis("y", lines(rect.y, rect.height), candidates.map((candidate) => lines(candidate.y, candidate.height)), threshold)
  return { x: rect.x + x.delta, y: rect.y + y.delta, guides: [...x.guides, ...y.guides] }
}

/**
 * Candidate rects in the moving node's parent-local space: its siblings plus
 * the parent content box (a frame's own coordinate space spans `0 0 w h`).
 */
export function snapCandidates(document: DesignDocumentV1, id: DesignNodeId): DesignSnapRect[] {
  const node = document.nodes[id]
  if (!node) return []
  const parent = node.parentId === null ? undefined : document.nodes[node.parentId]
  const siblingIds = parent && (parent.type === "frame" || parent.type === "group") ? parent.childIds : document.rootIds
  const siblings = siblingIds
    .filter((siblingId) => siblingId !== id)
    .map((siblingId) => rectOf(document.nodes[siblingId]))
    .filter((rect): rect is DesignSnapRect => rect !== undefined)
  if (!parent || (parent.type !== "frame" && parent.type !== "group")) return siblings
  return [...siblings, { x: 0, y: 0, width: parent.transform.width, height: parent.transform.height }]
}

function rectOf(node: DesignNodeV1 | undefined): DesignSnapRect | undefined {
  if (!node) return undefined
  return { x: node.transform.x, y: node.transform.y, width: node.transform.width, height: node.transform.height }
}

function lines(start: number, size: number): readonly number[] {
  return [start, start + size / 2, start + size]
}

function snapAxis(
  axis: "x" | "y",
  moving: readonly number[],
  targets: readonly (readonly number[])[],
  threshold: number,
): { delta: number; guides: readonly DesignSnapGuide[] } {
  let best: { delta: number; guide: number } | undefined
  for (const targetLines of targets) {
    for (const target of targetLines) {
      for (const line of moving) {
        const delta = target - line
        if (Math.abs(delta) > threshold) continue
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, guide: target }
      }
    }
  }
  if (!best) return { delta: 0, guides: [] }
  return { delta: best.delta, guides: [{ axis, position: best.guide }] }
}
