/* SPDX-License-Identifier: MIT */

import type { DesignCommentV1, DesignDocumentV1, DesignNodeId } from "../model/schema"
import type { DesignPoint } from "./geometry"
import { nodeWorldRect } from "./selection"

/** Pending target for the next comment: a node anchor or a free zone. */
export type DesignCommentTarget = { nodeId: DesignNodeId | null; x: number; y: number }

/** Pin anchor offset from the node's top-right corner, in world units. */
export const commentPinOffset = 4

/**
 * World position of a comment pin (v51 rule, ADR-039 section 31): the
 * top-right corner of the anchored node's world rect while that node
 * resolves, otherwise the stored world position — which is also what a
 * comment keeps after its node is deleted.
 */
export function commentPinPosition(document: DesignDocumentV1, comment: DesignCommentV1): DesignPoint | undefined {
  if (comment.nodeId !== null) {
    const box = nodeWorldRect(document, comment.nodeId)
    if (box) return { x: box.x + box.width + commentPinOffset, y: box.y - commentPinOffset }
  }
  if (!Number.isFinite(comment.x) || !Number.isFinite(comment.y)) return undefined
  return { x: comment.x, y: comment.y }
}
