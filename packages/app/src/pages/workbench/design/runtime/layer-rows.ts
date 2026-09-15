/* SPDX-License-Identifier: MIT */

import type { DesignCommand } from "../model/commands"
import { isContainerNode, type DesignDocumentV1, type DesignNodeId } from "../model/schema"

export type DesignLayerRow = {
  id: DesignNodeId
  name: string
  depth: number
  visible: boolean
  locked: boolean
  container: boolean
  parentId: DesignNodeId | null
}

/**
 * Display rows for the Layers panel: frontmost first (ADR-039 section 10 lets
 * the panel reverse the canonical back-to-front order), parents before their
 * children. The canonical `childIds` remain the only ordering authority — the
 * panel never keeps an ordering model of its own.
 */
export function buildLayerRows(document: DesignDocumentV1): DesignLayerRow[] {
  const rows: DesignLayerRow[] = []
  const visit = (ids: readonly DesignNodeId[], depth: number) => {
    for (const id of [...ids].reverse()) {
      const node = document.nodes[id]
      if (!node) continue
      const container = isContainerNode(node)
      rows.push({
        id,
        name: node.name,
        depth,
        visible: node.visible,
        locked: node.locked,
        container,
        parentId: node.parentId,
      })
      if (container) visit(node.childIds, depth + 1)
    }
  }
  visit(document.rootIds, 0)
  return rows
}

/**
 * Resolves a layer drop into a domain command. Dropping onto a container from
 * another parent reparents into it (frontmost position); every other drop
 * moves the node to the target's position in the shared parent — as a
 * reorder when the parent is unchanged, as a reparent otherwise. Structural
 * refusals (cycles, locked participants, invalid containers) stay the domain
 * layer's job (ADR-039 section 11), whatever the drop attempts.
 */
export function resolveLayerDrop(
  document: DesignDocumentV1,
  draggedId: DesignNodeId,
  targetId: DesignNodeId,
): DesignCommand | undefined {
  if (draggedId === targetId) return undefined
  const dragged = document.nodes[draggedId]
  const target = document.nodes[targetId]
  if (!dragged || !target) return undefined

  if (isContainerNode(target) && dragged.parentId !== targetId) {
    return { kind: "reparentNode", id: draggedId, parentId: targetId, index: target.childIds.length }
  }

  const parentId = target.parentId
  const siblings = parentId === null ? document.rootIds : parentChildIds(document, parentId)
  const index = siblings.indexOf(targetId)
  if (index < 0) return undefined
  if (dragged.parentId === parentId) return { kind: "reorderNode", id: draggedId, toIndex: index }
  return { kind: "reparentNode", id: draggedId, parentId, index }
}

function parentChildIds(document: DesignDocumentV1, parentId: DesignNodeId): readonly DesignNodeId[] {
  const parent = document.nodes[parentId]
  if (!parent || !isContainerNode(parent)) return []
  return parent.childIds
}
