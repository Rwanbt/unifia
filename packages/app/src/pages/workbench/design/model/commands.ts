/* SPDX-License-Identifier: MIT */

import type { PathData } from "./path"
import type { DesignCommentV1, DesignNodeId, DesignNodeV1, DesignPointV1, DesignTransformV1 } from "./schema"

export type DesignNodePatch = {
  name?: string
  visible?: boolean
  locked?: boolean
}

/**
 * Typed, serializable document mutations. One user gesture becomes one
 * command (and one history entry); renderers and UI never edit nodes
 * directly (ADR-039 sections 3.4 and 12).
 */
export type DesignCommand =
  | { kind: "insertNode"; node: DesignNodeV1; parentId: DesignNodeId | null; index?: number }
  | { kind: "deleteNode"; id: DesignNodeId }
  | { kind: "deleteNodes"; ids: readonly DesignNodeId[] }
  | ({ kind: "updateNode"; id: DesignNodeId } & DesignNodePatch)
  | { kind: "updateTransform"; id: DesignNodeId; transform: DesignTransformV1 }
  | { kind: "translateNodes"; moves: readonly { id: DesignNodeId; delta: DesignPointV1 }[] }
  | { kind: "updatePoints"; id: DesignNodeId; points: readonly DesignPointV1[] }
  | { kind: "updatePath"; id: DesignNodeId; data: PathData }
  | { kind: "reorderNode"; id: DesignNodeId; toIndex: number }
  | { kind: "reparentNode"; id: DesignNodeId; parentId: DesignNodeId | null; index?: number }
  | { kind: "setVisibility"; id: DesignNodeId; visible: boolean }
  | { kind: "setLocked"; id: DesignNodeId; locked: boolean }
  | { kind: "duplicateNode"; id: DesignNodeId; ids: Record<DesignNodeId, DesignNodeId> }
  | { kind: "addComment"; comment: DesignCommentV1 }
  | { kind: "setCommentResolved"; id: string; resolved: boolean }
  | { kind: "deleteComment"; id: string }
