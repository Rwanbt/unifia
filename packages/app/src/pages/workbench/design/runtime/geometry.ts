/* SPDX-License-Identifier: MIT */

import { DesignDocumentError } from "../model/errors"
import type { DesignDocumentV1, DesignNodeId, DesignTransformV1 } from "../model/schema"

/** Affine matrix [a c e; b d f], same convention as canvas/Konva transforms. */
export type DesignMatrix = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export type DesignPoint = { x: number; y: number }

export const identityMatrix: DesignMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Returns `left ∘ right` (right applies first). */
export function multiplyMatrices(left: DesignMatrix, right: DesignMatrix): DesignMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

export function applyToPoint(matrix: DesignMatrix, point: DesignPoint): DesignPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

/** Linear part of the matrix applied to a vector, translation excluded. */
export function applyLinear(matrix: DesignMatrix, vector: DesignPoint): DesignPoint {
  return { x: matrix.a * vector.x + matrix.c * vector.y, y: matrix.b * vector.x + matrix.d * vector.y }
}

/**
 * Inverse of the linear part applied to a vector. Every design matrix is
 * rotation + translation only — `localMatrix` never encodes scale, since
 * `width`/`height` are the authoritative size — so the linear part is
 * orthogonal and its inverse is the transpose.
 */
export function applyInverseLinear(matrix: DesignMatrix, vector: DesignPoint): DesignPoint {
  return { x: matrix.d * vector.x - matrix.c * vector.y, y: -matrix.b * vector.x + matrix.a * vector.y }
}

/**
 * Node-local -> parent-local matrix. Rotation is clockwise (screen y-down)
 * around the node centre, matching the canonical transform semantics of
 * ADR-039 section 6: `width`/`height` are authoritative and scale is never
 * part of the persisted representation.
 */
export function localMatrix(transform: DesignTransformV1): DesignMatrix {
  const angle = (transform.rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const centerX = transform.width / 2
  const centerY = transform.height / 2
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: transform.x + centerX - (cos * centerX - sin * centerY),
    f: transform.y + centerY - (sin * centerX + cos * centerY),
  }
}

/** Composes the ancestor chain down to `id`, yielding the world matrix. */
export function nodeMatrix(document: DesignDocumentV1, id: DesignNodeId): DesignMatrix {
  const node = document.nodes[id]
  if (!node) throw new DesignDocumentError("node-not-found", `no design node "${id}"`)
  const parent = node.parentId === null ? identityMatrix : nodeMatrix(document, node.parentId)
  return multiplyMatrices(parent, localMatrix(node.transform))
}
