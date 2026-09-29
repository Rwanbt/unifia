/* SPDX-License-Identifier: MIT */

import { isAncestor, type DesignDocumentV1, type DesignNodeId } from "../model/schema"
import { applyInverseLinear, applyToPoint, identityMatrix, nodeMatrix, type DesignMatrix, type DesignPoint } from "./geometry"

/**
 * Selection rules shared by the canvas, the layers panel and the keyboard
 * (ADR-039 #112). A selection never mixes a container with one of its own
 * descendants: translating both in one gesture would move the descendant
 * twice, so every path that grows a selection funnels through
 * `normalizeSelection` or `toggleSelection`.
 */

/** Drops every node that has another listed node as one of its descendants. */
export function normalizeSelection(document: DesignDocumentV1, ids: readonly DesignNodeId[]): readonly DesignNodeId[] {
  return ids.filter((id) => !ids.some((other) => other !== id && isAncestor(document, id, other)))
}

/**
 * Modifier-click semantics: adding a node drops the listed nodes it contains
 * (escalation) and any listed ancestor it sits inside (drill-down), so the
 * result always respects the selection invariant.
 */
export function toggleSelection(
  document: DesignDocumentV1,
  selection: readonly DesignNodeId[],
  id: DesignNodeId,
): readonly DesignNodeId[] {
  if (selection.includes(id)) return selection.filter((entry) => entry !== id)
  const kept = selection.filter((entry) => !isAncestor(document, id, entry) && !isAncestor(document, entry, id))
  return [...kept, id]
}

/**
 * Parent-space deltas that reproduce `worldDelta` for every listed node
 * (locked nodes are dropped: they never move). Konva parents mirror the
 * document hierarchy, so these deltas also drive the transient drag.
 */
export function selectionMoves(
  document: DesignDocumentV1,
  ids: readonly DesignNodeId[],
  worldDelta: DesignPoint,
): readonly { id: DesignNodeId; delta: DesignPoint }[] {
  const moves: { id: DesignNodeId; delta: DesignPoint }[] = []
  for (const id of ids) {
    const node = document.nodes[id]
    if (!node || node.locked) continue
    moves.push({ id, delta: applyInverseLinear(parentMatrix(document, id) ?? identityMatrix, worldDelta) })
  }
  return moves
}

/** World-space AABB of a node's transform rect (hit tests, outlines). */
export function nodeWorldRect(
  document: DesignDocumentV1,
  id: DesignNodeId,
): { x: number; y: number; width: number; height: number } | undefined {
  const node = document.nodes[id]
  if (!node) return undefined
  const matrix = nodeMatrix(document, id)
  const { width, height } = node.transform
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((corner) => applyToPoint(matrix, corner))
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

/**
 * Marquee hit test over visible, unlocked nodes, then normalised so a frame
 * that merely contains the marquee does not shadow the children it wraps.
 */
export function pickInRect(
  document: DesignDocumentV1,
  rect: { x: number; y: number; width: number; height: number },
): readonly DesignNodeId[] {
  const hits: DesignNodeId[] = []
  for (const node of Object.values(document.nodes)) {
    if (!node.visible || node.locked) continue
    const box = nodeWorldRect(document, node.id)
    if (!box) continue
    const intersects =
      box.x < rect.x + rect.width && box.x + box.width > rect.x && box.y < rect.y + rect.height && box.y + box.height > rect.y
    if (intersects) hits.push(node.id)
  }
  return normalizeSelection(document, hits)
}

/** World matrix of a node's parent — identity for root nodes. */
export function parentMatrix(document: DesignDocumentV1, id: DesignNodeId): DesignMatrix | undefined {
  const node = document.nodes[id]
  if (!node) return undefined
  return node.parentId === null ? identityMatrix : nodeMatrix(document, node.parentId)
}
