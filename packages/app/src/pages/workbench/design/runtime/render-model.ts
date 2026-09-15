/* SPDX-License-Identifier: MIT */

import { DesignDocumentError } from "../model/errors"
import type { DesignDocumentV1, DesignNodeId, DesignNodeV1 } from "../model/schema"
import { identityMatrix, localMatrix, multiplyMatrices, type DesignMatrix } from "./geometry"

export type DesignRenderEntry = {
  id: DesignNodeId
  node: DesignNodeV1
  matrix: DesignMatrix
  depth: number
}

/**
 * Flattens the canonical hierarchy into paint order: `rootIds` index 0
 * paints first (furthest back), a parent paints before its children, later
 * siblings paint above earlier ones (ADR-039 section 10). Hidden and locked
 * nodes are included — the renderer decides what to draw, the interaction
 * layer decides what is selectable.
 */
export function buildRenderList(document: DesignDocumentV1): DesignRenderEntry[] {
  const entries: DesignRenderEntry[] = []
  for (const rootId of document.rootIds) visit(document, rootId, identityMatrix, 0, entries)
  return entries
}

function visit(
  document: DesignDocumentV1,
  id: DesignNodeId,
  parent: DesignMatrix,
  depth: number,
  entries: DesignRenderEntry[],
): void {
  const node = document.nodes[id]
  if (!node) throw new DesignDocumentError("node-not-found", `no design node "${id}"`)
  const matrix = multiplyMatrices(parent, localMatrix(node.transform))
  entries.push({ id, node, matrix, depth })
  if (node.type !== "frame" && node.type !== "group") return
  for (const childId of node.childIds) visit(document, childId, matrix, depth + 1, entries)
}
