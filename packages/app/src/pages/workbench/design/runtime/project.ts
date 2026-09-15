/* SPDX-License-Identifier: MIT */

import { DesignDocumentError } from "../model/errors"
import type { DesignDocumentV1, DesignNodeId, DesignNodeV1 } from "../model/schema"

export type DesignProjectionNode = {
  id: DesignNodeId
  node: DesignNodeV1
  children: DesignProjectionNode[]
}

/**
 * Builds the render hierarchy from the canonical document. A dangling
 * reference throws instead of rendering a silently incomplete scene: the
 * loader validates (ADR-039 section 15), this is the render-time backstop.
 */
export function projectDocument(document: DesignDocumentV1): DesignProjectionNode[] {
  return document.rootIds.map((id) => projectNode(document, id))
}

function projectNode(document: DesignDocumentV1, id: DesignNodeId): DesignProjectionNode {
  const node = document.nodes[id]
  if (!node) throw new DesignDocumentError("node-not-found", `no design node "${id}"`)
  const childIds = node.type === "frame" || node.type === "group" ? node.childIds : []
  return { id, node, children: childIds.map((childId) => projectNode(document, childId)) }
}
