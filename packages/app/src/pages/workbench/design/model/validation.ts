/* SPDX-License-Identifier: MIT */

import { DesignDocumentError } from "./errors"
import {
  designDocumentV1Schema,
  isContainerNode,
  type DesignDocumentV1,
  type DesignNodeId,
} from "./schema"

export type DesignDocumentInspection =
  | { ok: true; document: DesignDocumentV1 }
  | { ok: false; issues: readonly string[] }

/**
 * Parses and structurally validates an untrusted document. Zod covers the
 * value shape; the structure pass covers everything zod cannot express:
 * key/id agreement, root membership, parent/child consistency, single
 * membership, reachability (covers detached cycles) — ADR-039 section 15.
 */
export function inspectDesignDocument(value: unknown): DesignDocumentInspection {
  const parsed = designDocumentV1Schema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) }
  }
  const issues = collectStructureIssues(parsed.data)
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, document: parsed.data }
}

export function parseDesignDocument(value: unknown): DesignDocumentV1 {
  const inspection = inspectDesignDocument(value)
  if (inspection.ok) return inspection.document
  throw new DesignDocumentError("invalid-document", `invalid design document: ${inspection.issues.join("; ")}`)
}

function collectStructureIssues(document: DesignDocumentV1): string[] {
  const issues: string[] = []
  const roots = new Set<DesignNodeId>()
  const parentOf = new Map<DesignNodeId, DesignNodeId>()

  collectRootIssues(document, roots, issues)
  collectContainerIssues(document, parentOf, issues)
  collectParentIssues(document, roots, parentOf, issues)
  collectReachabilityIssues(document, roots, issues)
  collectCommentIssues(document, issues)
  return issues
}

/**
 * Comments anchor to nodes, but a dangling anchor is deliberately accepted:
 * a comment survives the deletion of its node and falls back to its stored
 * world position (ADR-039 section 31). Only identity is structural.
 */
function collectCommentIssues(document: DesignDocumentV1, issues: string[]): void {
  const seen = new Set<string>()
  for (const comment of document.comments ?? []) {
    if (seen.has(comment.id)) issues.push(`comments: duplicate id "${comment.id}"`)
    seen.add(comment.id)
  }
}

function collectRootIssues(document: DesignDocumentV1, roots: Set<DesignNodeId>, issues: string[]): void {
  for (const id of document.rootIds) {
    if (roots.has(id)) {
      issues.push(`rootIds: duplicate entry "${id}"`)
      continue
    }
    roots.add(id)
    const node = document.nodes[id]
    if (!node) {
      issues.push(`rootIds: no node "${id}"`)
      continue
    }
    if (node.parentId !== null) issues.push(`nodes["${id}"].parentId: root node declares parent "${node.parentId}"`)
  }
}

function collectContainerIssues(
  document: DesignDocumentV1,
  parentOf: Map<DesignNodeId, DesignNodeId>,
  issues: string[],
): void {
  for (const [key, node] of Object.entries(document.nodes)) {
    if (!isContainerNode(node)) continue
    const seen = new Set<DesignNodeId>()
    for (const childId of node.childIds) {
      if (seen.has(childId)) {
        issues.push(`nodes["${key}"].childIds: duplicate entry "${childId}"`)
        continue
      }
      seen.add(childId)
      if (!document.nodes[childId]) {
        issues.push(`nodes["${key}"].childIds: no node "${childId}"`)
        continue
      }
      const previous = parentOf.get(childId)
      if (previous !== undefined) {
        issues.push(`nodes["${childId}"]: referenced by both "${previous}" and "${key}"`)
        continue
      }
      parentOf.set(childId, key)
    }
  }
}

function collectParentIssues(
  document: DesignDocumentV1,
  roots: Set<DesignNodeId>,
  parentOf: Map<DesignNodeId, DesignNodeId>,
  issues: string[],
): void {
  for (const [key, node] of Object.entries(document.nodes)) {
    if (key !== node.id) issues.push(`nodes["${key}"]: key does not match node.id "${node.id}"`)
    const declared = node.parentId
    if (declared === null) {
      if (!roots.has(node.id)) issues.push(`nodes["${node.id}"]: parentless node is not listed in rootIds`)
      continue
    }
    const actual = parentOf.get(node.id)
    if (actual === undefined) issues.push(`nodes["${node.id}"].parentId: no container lists "${node.id}"`)
    else if (actual !== declared) issues.push(`nodes["${node.id}"].parentId: declares "${declared}" but listed by "${actual}"`)
  }
}

function collectReachabilityIssues(document: DesignDocumentV1, roots: Set<DesignNodeId>, issues: string[]): void {
  const visited = new Set<DesignNodeId>()
  const stack = [...roots]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    const node = document.nodes[current]
    if (node && isContainerNode(node)) stack.push(...node.childIds)
  }
  const unreachable = Object.keys(document.nodes).filter((id) => !visited.has(id))
  if (unreachable.length > 0) issues.push(`nodes: unreachable from rootIds (orphan or cycle): ${unreachable.join(", ")}`)
}
