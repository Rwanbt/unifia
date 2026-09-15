/* SPDX-License-Identifier: MIT */

import type { DesignNodeId, DesignNodeV1, DesignTransformV1 } from "./schema"

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
  | ({ kind: "updateNode"; id: DesignNodeId } & DesignNodePatch)
  | { kind: "updateTransform"; id: DesignNodeId; transform: DesignTransformV1 }
  | { kind: "reorderNode"; id: DesignNodeId; toIndex: number }
  | { kind: "reparentNode"; id: DesignNodeId; parentId: DesignNodeId | null; index?: number }
  | { kind: "setVisibility"; id: DesignNodeId; visible: boolean }
  | { kind: "setLocked"; id: DesignNodeId; locked: boolean }
  | { kind: "duplicateNode"; id: DesignNodeId; ids: Record<DesignNodeId, DesignNodeId> }
