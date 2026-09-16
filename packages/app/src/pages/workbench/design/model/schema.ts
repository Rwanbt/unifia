/* SPDX-License-Identifier: MIT */

import { z } from "zod"

/** Canonical format version understood by this runtime (ADR-039 section 4). */
export const DESIGN_SCHEMA_VERSION = 1

export type DesignNodeId = string

const idSchema = z.string().min(1)

export const designTransformV1Schema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number(),
})

export const designStyleV1Schema = z.strictObject({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  opacity: z.number().min(0).max(1).optional(),
})

const nodeBaseShape = {
  id: idSchema,
  name: z.string(),
  parentId: idSchema.nullable(),
  visible: z.boolean(),
  locked: z.boolean(),
  transform: designTransformV1Schema,
}

export const designPointV1Schema = z.strictObject({ x: z.number(), y: z.number() })

export const frameNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("frame"),
  childIds: z.array(idSchema),
})

export const groupNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("group"),
  childIds: z.array(idSchema),
})

export const rectangleNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("rectangle"),
  style: designStyleV1Schema.optional(),
})

export const ellipseNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("ellipse"),
  style: designStyleV1Schema.optional(),
})

export const lineNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("line"),
  points: z.array(designPointV1Schema).min(2),
  stroke: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
})

export const pathNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("path"),
  /** SVG path data (`d`) — renderer-agnostic and export-ready. */
  d: z.string().min(1),
  style: designStyleV1Schema.optional(),
})

export const textNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("text"),
  text: z.string(),
  style: designStyleV1Schema.optional(),
})

export const imageNodeV1Schema = z.strictObject({
  ...nodeBaseShape,
  type: z.literal("image"),
  assetId: idSchema,
})

export const designNodeV1Schema = z.discriminatedUnion("type", [
  frameNodeV1Schema,
  groupNodeV1Schema,
  rectangleNodeV1Schema,
  ellipseNodeV1Schema,
  lineNodeV1Schema,
  pathNodeV1Schema,
  textNodeV1Schema,
  imageNodeV1Schema,
])

/** Asset metadata referenced by id; payloads live outside the document (ADR-039 section 20). */
export const designAssetV1Schema = z.strictObject({
  id: idSchema,
  kind: z.string().min(1),
  mimeType: z.string().optional(),
  source: z.string().optional(),
})

export const designDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(DESIGN_SCHEMA_VERSION),
  id: idSchema,
  name: z.string(),
  rootIds: z.array(idSchema),
  nodes: z.record(idSchema, designNodeV1Schema),
  assets: z.record(z.string().min(1), designAssetV1Schema).optional(),
  metadata: z
    .strictObject({
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
})

export type DesignTransformV1 = z.infer<typeof designTransformV1Schema>
export type DesignStyleV1 = z.infer<typeof designStyleV1Schema>
export type DesignPointV1 = z.infer<typeof designPointV1Schema>
export type FrameNodeV1 = z.infer<typeof frameNodeV1Schema>
export type GroupNodeV1 = z.infer<typeof groupNodeV1Schema>
export type RectangleNodeV1 = z.infer<typeof rectangleNodeV1Schema>
export type EllipseNodeV1 = z.infer<typeof ellipseNodeV1Schema>
export type LineNodeV1 = z.infer<typeof lineNodeV1Schema>
export type PathNodeV1 = z.infer<typeof pathNodeV1Schema>
export type TextNodeV1 = z.infer<typeof textNodeV1Schema>
export type ImageNodeV1 = z.infer<typeof imageNodeV1Schema>
export type DesignNodeV1 = z.infer<typeof designNodeV1Schema>
export type DesignAssetV1 = z.infer<typeof designAssetV1Schema>
export type DesignDocumentV1 = z.infer<typeof designDocumentV1Schema>
export type ContainerNodeV1 = FrameNodeV1 | GroupNodeV1

export function isContainerNode(node: DesignNodeV1): node is ContainerNodeV1 {
  return node.type === "frame" || node.type === "group"
}

/**
 * True when `ancestorId` sits anywhere up `id`'s parent chain. Selection and
 * deletion need it so a container and one of its descendants never take part
 * in the same operation (translating both would move the descendant twice).
 */
export function isAncestor(document: DesignDocumentV1, ancestorId: DesignNodeId, id: DesignNodeId): boolean {
  let current: DesignNodeId | null = document.nodes[id]?.parentId ?? null
  while (current !== null) {
    if (current === ancestorId) return true
    current = document.nodes[current]?.parentId ?? null
  }
  return false
}
