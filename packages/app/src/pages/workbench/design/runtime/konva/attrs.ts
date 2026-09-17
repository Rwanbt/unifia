/* SPDX-License-Identifier: MIT */

import type { DesignTransformV1 } from "../../model/schema"

/**
 * Konva transform attributes. The origin is moved to the node centre
 * (position = centre, offset = half size) so `rotation` turns the node
 * around its centre exactly like the canonical semantics (ADR-039 section 6).
 */
export type DesignKonvaAttrs = {
  x: number
  y: number
  offsetX: number
  offsetY: number
  rotation: number
}

export function toKonvaAttrs(transform: DesignTransformV1): DesignKonvaAttrs {
  return {
    x: transform.x + transform.width / 2,
    y: transform.y + transform.height / 2,
    offsetX: transform.width / 2,
    offsetY: transform.height / 2,
    rotation: transform.rotation,
  }
}

/**
 * Folds a Konva node state back into a canonical transform. Resize is
 * committed as `width`/`height`; scale is never persisted. Negative scale
 * (flip) is treated as magnitude — explicit mirror semantics are a future
 * extension (ADR-039 section 6), never a silently persisted negative size.
 */
export function commitTransform(
  current: DesignTransformV1,
  state: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
): DesignTransformV1 {
  const width = Math.abs(current.width * state.scaleX)
  const height = Math.abs(current.height * state.scaleY)
  return { x: state.x - width / 2, y: state.y - height / 2, width, height, rotation: state.rotation }
}
