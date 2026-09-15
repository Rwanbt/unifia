/* SPDX-License-Identifier: MIT */

import { DesignDocumentError } from "./errors"
import {
  DESIGN_SCHEMA_VERSION,
  isContainerNode,
  type DesignDocumentV1,
  type DesignNodeV1,
  type DesignTransformV1,
  type FrameNodeV1,
  type LineNodeV1,
  type PathNodeV1,
  type RectangleNodeV1,
} from "./schema"

/** Test-only builders for canonical documents. */

export const zeroTransform: DesignTransformV1 = { x: 0, y: 0, width: 10, height: 10, rotation: 0 }

export function rect(id: string, overrides: Partial<RectangleNodeV1> = {}): RectangleNodeV1 {
  return {
    id,
    name: id,
    parentId: null,
    visible: true,
    locked: false,
    type: "rectangle",
    transform: { ...zeroTransform },
    ...overrides,
  }
}

export function frame(id: string, childIds: string[] = [], overrides: Partial<FrameNodeV1> = {}): FrameNodeV1 {
  return {
    id,
    name: id,
    parentId: null,
    visible: true,
    locked: false,
    type: "frame",
    transform: { ...zeroTransform },
    childIds,
    ...overrides,
  }
}

export function line(id: string, overrides: Partial<LineNodeV1> = {}): LineNodeV1 {
  return {
    id,
    name: id,
    parentId: null,
    visible: true,
    locked: false,
    type: "line",
    transform: { ...zeroTransform },
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    ...overrides,
  }
}

export function path(id: string, overrides: Partial<PathNodeV1> = {}): PathNodeV1 {
  return {
    id,
    name: id,
    parentId: null,
    visible: true,
    locked: false,
    type: "path",
    transform: { ...zeroTransform },
    d: "M 0 0 L 10 10",
    ...overrides,
  }
}

export function doc(
  nodes: DesignNodeV1[],
  rootIds: string[] = nodes.filter((node) => node.parentId === null).map((node) => node.id),
): DesignDocumentV1 {
  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    rootIds,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  }
}

/** Runs `run` and returns the thrown DesignDocumentError, failing otherwise. */
export function expectError(run: () => unknown): DesignDocumentError {
  try {
    run()
  } catch (error) {
    if (error instanceof DesignDocumentError) return error
    throw error
  }
  throw new Error("expected a DesignDocumentError")
}

/** Reads a container's ordered children, failing when `id` is not a container. */
export function childrenOf(document: DesignDocumentV1, id: string): readonly string[] {
  const node = document.nodes[id]
  if (!node || !isContainerNode(node)) throw new Error(`"${id}" is not a container`)
  return node.childIds
}
