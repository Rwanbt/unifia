/* SPDX-License-Identifier: MIT */

import type { DesignCommand } from "./commands"
import { DesignDocumentError } from "./errors"
import { pathBounds, serializePath, translatePath, type PathData } from "./path"
import {
  isAncestor,
  isContainerNode,
  type ContainerNodeV1,
  type DesignDocumentV1,
  type DesignNodeId,
  type DesignNodeV1,
  type DesignPointV1,
  type DesignTransformV1,
} from "./schema"

/**
 * Pure command application. Returns a new document; the input is never
 * mutated. Structural safety (existence, container capability, locking,
 * cycles) is enforced here regardless of the command's origin — UI, canvas,
 * keyboard, automation or an AI agent (ADR-039 sections 11 and 12).
 */
export function applyCommand(document: DesignDocumentV1, command: DesignCommand): DesignDocumentV1 {
  switch (command.kind) {
    case "insertNode":
      return insertNode(document, command.node, command.parentId, command.index)
    case "deleteNode":
      return deleteNode(document, command.id)
    case "deleteNodes":
      return deleteNodes(document, command.ids)
    case "updateNode":
      return updateNode(document, command.id, command)
    case "updateTransform":
      return updateTransform(document, command.id, command.transform)
    case "translateNodes":
      return translateNodes(document, command.moves)
    case "updatePoints":
      return updatePoints(document, command.id, command.points)
    case "updatePath":
      return updatePath(document, command.id, command.data)
    case "reorderNode":
      return reorderNode(document, command.id, command.toIndex)
    case "reparentNode":
      return reparentNode(document, command.id, command.parentId, command.index)
    case "setVisibility":
      return updateNode(document, command.id, { visible: command.visible })
    case "setLocked":
      return updateNode(document, command.id, { locked: command.locked })
    case "duplicateNode":
      return duplicateNode(document, command.id, command.ids)
  }
}

function requireNode(document: DesignDocumentV1, id: DesignNodeId): DesignNodeV1 {
  const node = document.nodes[id]
  if (!node) throw new DesignDocumentError("node-not-found", `no design node "${id}"`)
  return node
}

function requireUnlocked(document: DesignDocumentV1, id: DesignNodeId): DesignNodeV1 {
  const node = requireNode(document, id)
  if (node.locked) throw new DesignDocumentError("node-locked", `node "${id}" is locked`)
  return node
}

function requireParent(document: DesignDocumentV1, id: DesignNodeId): ContainerNodeV1 {
  const node = document.nodes[id]
  if (!node) throw new DesignDocumentError("parent-not-found", `no design node "${id}"`)
  if (!isContainerNode(node)) throw new DesignDocumentError("parent-not-container", `node "${id}" is not a frame or group`)
  return node
}

function siblingsOf(document: DesignDocumentV1, node: DesignNodeV1): DesignNodeId[] {
  if (node.parentId === null) return document.rootIds
  const parent = document.nodes[node.parentId]
  if (!parent || !isContainerNode(parent)) {
    throw new DesignDocumentError("parent-not-found", `no container "${node.parentId}"`)
  }
  return parent.childIds
}

function withSiblings(document: DesignDocumentV1, parentId: DesignNodeId | null, childIds: DesignNodeId[]): DesignDocumentV1 {
  if (parentId === null) return { ...document, rootIds: childIds }
  const parent = requireParent(document, parentId)
  return { ...document, nodes: { ...document.nodes, [parentId]: { ...parent, childIds } } }
}

function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(Math.trunc(index), max))
}

function insertAt(ids: readonly DesignNodeId[], index: number, id: DesignNodeId): DesignNodeId[] {
  return [...ids.slice(0, index), id, ...ids.slice(index)]
}

function collectSubtree(document: DesignDocumentV1, id: DesignNodeId, seen = new Set<DesignNodeId>()): Set<DesignNodeId> {
  const node = document.nodes[id]
  if (!node || seen.has(id)) return seen
  seen.add(id)
  if (isContainerNode(node)) {
    for (const childId of node.childIds) collectSubtree(document, childId, seen)
  }
  return seen
}

function insertNode(
  document: DesignDocumentV1,
  node: DesignNodeV1,
  parentId: DesignNodeId | null,
  index: number | undefined,
): DesignDocumentV1 {
  if (document.nodes[node.id]) throw new DesignDocumentError("duplicate-id", `node "${node.id}" already exists`)
  if (isContainerNode(node) && node.childIds.length > 0) {
    throw new DesignDocumentError("invalid-child-ids", `insert "${node.id}" with no children; insert children separately`)
  }
  const siblings = parentId === null ? document.rootIds : requireParent(document, parentId).childIds
  const at = clampIndex(index ?? siblings.length, siblings.length)
  const nodes = { ...document.nodes, [node.id]: { ...node, parentId } }
  return withSiblings({ ...document, nodes }, parentId, insertAt(siblings, at, node.id))
}

function deleteNode(document: DesignDocumentV1, id: DesignNodeId): DesignDocumentV1 {
  const node = requireUnlocked(document, id)
  const nodes = { ...document.nodes }
  for (const member of collectSubtree(document, id)) delete nodes[member]
  const siblings = siblingsOf(document, node).filter((candidate) => candidate !== id)
  return withSiblings({ ...document, nodes }, node.parentId, siblings)
}

/**
 * Multi-select delete: every listed node is validated against the source
 * document before any removal, and a container listed alongside one of its
 * descendants collapses to the container alone (its subtree already goes).
 */
function deleteNodes(document: DesignDocumentV1, ids: readonly DesignNodeId[]): DesignDocumentV1 {
  if (ids.length === 0) throw new DesignDocumentError("invalid-command", "a deletion needs at least one node")
  const roots = ids.filter((id) => !ids.some((other) => other !== id && isAncestor(document, other, id)))
  for (const id of roots) requireUnlocked(document, id)
  return roots.reduce((next, id) => deleteNode(next, id), document)
}

function updateNode(document: DesignDocumentV1, id: DesignNodeId, patch: { name?: string; visible?: boolean; locked?: boolean }): DesignDocumentV1 {
  const node = requireNode(document, id)
  const next: DesignNodeV1 = { ...node }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.visible !== undefined) next.visible = patch.visible
  if (patch.locked !== undefined) next.locked = patch.locked
  return { ...document, nodes: { ...document.nodes, [id]: next } }
}

function updateTransform(document: DesignDocumentV1, id: DesignNodeId, transform: DesignTransformV1): DesignDocumentV1 {
  const node = requireUnlocked(document, id)
  assertTransform(transform)
  return { ...document, nodes: { ...document.nodes, [id]: { ...node, transform } } }
}

function assertTransform(transform: DesignTransformV1): void {
  const values = [transform.x, transform.y, transform.width, transform.height, transform.rotation]
  if (values.some((value) => !Number.isFinite(value)) || transform.width < 0 || transform.height < 0) {
    throw new DesignDocumentError("invalid-transform", "transform must be finite with non-negative dimensions")
  }
}

/**
 * Multi-select move: each entry carries its own parent-space delta because
 * the caller derives it per node (parents may sit at different rotations).
 * Every target is validated before any node is touched, so a batch that
 * contains a locked or unknown node fails whole instead of moving half a
 * selection.
 */
function translateNodes(document: DesignDocumentV1, moves: readonly { id: DesignNodeId; delta: DesignPointV1 }[]): DesignDocumentV1 {
  if (moves.length === 0) throw new DesignDocumentError("invalid-command", "a translation needs at least one node")
  const moved = new Set<DesignNodeId>()
  const nodes = { ...document.nodes }
  for (const move of moves) {
    if (moved.has(move.id)) throw new DesignDocumentError("invalid-command", `node "${move.id}" is moved twice`)
    moved.add(move.id)
    const node = requireUnlocked(document, move.id)
    if (!Number.isFinite(move.delta.x) || !Number.isFinite(move.delta.y)) {
      throw new DesignDocumentError("invalid-command", "translation deltas must be finite")
    }
    nodes[move.id] = {
      ...node,
      transform: { ...node.transform, x: node.transform.x + move.delta.x, y: node.transform.y + move.delta.y },
    }
  }
  return { ...document, nodes }
}

/**
 * Line anchor editing: the caller supplies points in parent space (where the
 * transform lives); the reducer re-derives the bounding-box transform and the
 * node-local points, so a dragged anchor keeps world geometry exact even when
 * the bounding box moves.
 */
function updatePoints(document: DesignDocumentV1, id: DesignNodeId, points: readonly DesignPointV1[]): DesignDocumentV1 {
  const node = requireUnlocked(document, id)
  if (node.type !== "line") {
    throw new DesignDocumentError("not-editable", `node "${id}" has no editable points`)
  }
  if (node.transform.rotation !== 0) {
    throw new DesignDocumentError("not-editable", `node "${id}" must not be rotated to edit its points`)
  }
  if (points.length < 2) throw new DesignDocumentError("invalid-points", "point editing needs at least two points")
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new DesignDocumentError("invalid-points", "points must be finite")
    }
  }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const local = points.map((point) => ({ x: point.x - minX, y: point.y - minY }))
  const transform: DesignTransformV1 = {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    rotation: 0,
  }
  return { ...document, nodes: { ...document.nodes, [id]: { ...node, transform, points: local } } }
}

/**
 * Path editing: same contract as `updatePoints`, for the editable path
 * subset. The bounding box is the tight curve bounds, so the transform never
 * claims space the curve does not fill.
 */
function updatePath(document: DesignDocumentV1, id: DesignNodeId, data: PathData): DesignDocumentV1 {
  const node = requireUnlocked(document, id)
  if (node.type !== "path") throw new DesignDocumentError("not-editable", `node "${id}" is not a path`)
  if (node.transform.rotation !== 0) {
    throw new DesignDocumentError("not-editable", `node "${id}" must not be rotated to edit its path`)
  }
  const bounds = pathBounds(data)
  if (!bounds) throw new DesignDocumentError("invalid-points", "path data must be finite with at least one segment")
  const transform: DesignTransformV1 = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, rotation: 0 }
  return {
    ...document,
    nodes: { ...document.nodes, [id]: { ...node, transform, d: serializePath(translatePath(data, { x: -bounds.x, y: -bounds.y })) } },
  }
}

function reorderNode(document: DesignDocumentV1, id: DesignNodeId, toIndex: number): DesignDocumentV1 {
  const node = requireUnlocked(document, id)
  const siblings = siblingsOf(document, node)
  const from = siblings.indexOf(id)
  const to = clampIndex(toIndex, siblings.length - 1)
  if (from === to) return document
  const next = [...siblings]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return withSiblings(document, node.parentId, next)
}

function reparentNode(
  document: DesignDocumentV1,
  id: DesignNodeId,
  parentId: DesignNodeId | null,
  index: number | undefined,
): DesignDocumentV1 {
  const node = requireUnlocked(document, id)
  if (parentId === id) throw new DesignDocumentError("cycle", `cannot reparent "${id}" into itself`)
  if (parentId !== null) {
    const target = requireParent(document, parentId)
    if (target.locked) throw new DesignDocumentError("target-locked", `container "${parentId}" is locked`)
    if (collectSubtree(document, id).has(parentId)) {
      throw new DesignDocumentError("cycle", `cannot reparent "${id}" into its own descendant "${parentId}"`)
    }
  }
  const sameParent = parentId === node.parentId
  const leftovers = siblingsOf(document, node).filter((candidate) => candidate !== id)
  const destination = sameParent
    ? leftovers
    : parentId === null
      ? document.rootIds
      : requireParent(document, parentId).childIds
  const at = clampIndex(index ?? destination.length, destination.length)
  const moved = insertAt(destination, at, id)
  const detached = sameParent ? document : withSiblings(document, node.parentId, leftovers)
  const nodes = { ...detached.nodes, [id]: { ...node, parentId } }
  return withSiblings({ ...detached, nodes }, parentId, moved)
}

function duplicateNode(document: DesignDocumentV1, id: DesignNodeId, ids: Record<DesignNodeId, DesignNodeId>): DesignDocumentV1 {
  const node = requireUnlocked(document, id)
  const subtree = collectSubtree(document, id)
  const assigned = new Set<DesignNodeId>()
  for (const member of subtree) {
    const nextId = newIdFor(ids, member)
    if (document.nodes[nextId]) throw new DesignDocumentError("duplicate-id", `node "${nextId}" already exists`)
    if (assigned.has(nextId)) throw new DesignDocumentError("duplicate-id", `new id "${nextId}" is assigned twice`)
    assigned.add(nextId)
  }
  const nodes = { ...document.nodes }
  for (const member of subtree) {
    const source = requireNode(document, member)
    const parentId = member === id ? node.parentId : source.parentId === null ? null : newIdFor(ids, source.parentId)
    const copy: DesignNodeV1 = {
      ...source,
      id: newIdFor(ids, member),
      parentId,
      name: member === id ? `${source.name} copy` : source.name,
    }
    nodes[copy.id] = isContainerNode(copy)
      ? { ...copy, childIds: copy.childIds.map((childId) => newIdFor(ids, childId)) }
      : copy
  }
  const siblings = siblingsOf(document, node)
  const at = siblings.indexOf(id) + 1
  return withSiblings({ ...document, nodes }, node.parentId, insertAt(siblings, at, newIdFor(ids, id)))
}

function newIdFor(ids: Record<DesignNodeId, DesignNodeId>, id: DesignNodeId): DesignNodeId {
  const next = ids[id]
  if (!next) throw new DesignDocumentError("missing-new-id", `missing new id for "${id}"`)
  return next
}
