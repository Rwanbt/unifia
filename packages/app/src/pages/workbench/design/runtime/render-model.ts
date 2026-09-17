/* SPDX-License-Identifier: MIT */

import type { DesignDocumentV1, DesignNodeId, DesignNodeV1 } from "../model/schema"
import { identityMatrix, localMatrix, multiplyMatrices, type DesignMatrix } from "./geometry"
import { projectDocument, type DesignProjectionNode } from "./project"

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
  for (const root of projectDocument(document)) visit(root, identityMatrix, 0, entries)
  return entries
}

function visit(item: DesignProjectionNode, parent: DesignMatrix, depth: number, entries: DesignRenderEntry[]): void {
  const matrix = multiplyMatrices(parent, localMatrix(item.node.transform))
  entries.push({ id: item.id, node: item.node, matrix, depth })
  for (const child of item.children) visit(child, matrix, depth + 1, entries)
}
