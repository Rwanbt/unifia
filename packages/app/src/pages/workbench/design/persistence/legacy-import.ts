/* SPDX-License-Identifier: MIT */

import { DesignDocumentError } from "../model/errors"
import {
  DESIGN_SCHEMA_VERSION,
  type DesignAssetV1,
  type DesignDocumentV1,
  type DesignNodeV1,
  type DesignPointV1,
  type DesignStyleV1,
} from "../model/schema"
import { parseDesignDocument } from "../model/validation"

export type LegacyImportSkip = { id: string; type: string; reason: string }

export type LegacyImportResult = {
  document: DesignDocumentV1
  skipped: readonly LegacyImportSkip[]
  approximated: readonly string[]
}

type LegacyPoint = [number, number] | { x: number; y: number }

type LegacyElement = {
  id?: unknown
  type?: unknown
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  angle?: unknown
  isDeleted?: unknown
  locked?: unknown
  strokeColor?: unknown
  backgroundColor?: unknown
  strokeWidth?: unknown
  opacity?: unknown
  roughness?: unknown
  fillStyle?: unknown
  text?: unknown
  points?: unknown
  fileId?: unknown
  frameId?: unknown
}

type LegacyScene = {
  elements: readonly LegacyElement[]
  files?: Record<string, { dataURL?: unknown; mimeType?: unknown }>
}

/**
 * Converts a legacy Excalidraw sketch into a validated canonical document
 * (ADR-039 section 17). The snapshot is untrusted: every field is checked,
 * unknown element types are skipped and reported, and nothing is guessed.
 * The same input always produces the same document.
 */
export function importLegacySketch(raw: unknown, options: { id?: string; name?: string } = {}): LegacyImportResult {
  const scene = parseScene(raw)
  const nodes: Record<string, DesignNodeV1> = {}
  const assets: Record<string, DesignAssetV1> = {}
  const skipped: LegacyImportSkip[] = []
  const approximated = new Set<string>()
  const seen = new Set<string>()
  const order: string[] = []
  const frameChildren = new Map<string, string[]>()
  const frameOf = new Map<string, string>()

  for (const element of scene.elements) {
    if (element.isDeleted === true) continue
    const type = typeof element.type === "string" ? element.type : "unknown"
    const id = typeof element.id === "string" && element.id.length > 0 ? element.id : undefined
    if (!id) {
      skipped.push({ id: "(missing)", type, reason: "missing id" })
      continue
    }
    if (seen.has(id)) {
      skipped.push({ id, type, reason: "duplicate id" })
      continue
    }
    const outcome = convertElement(element, id, type, scene.files ?? {}, approximated)
    if (!outcome) {
      skipped.push({ id, type, reason: `unsupported element type "${type}"` })
      continue
    }
    seen.add(id)
    nodes[id] = outcome.node
    if (outcome.asset) assets[outcome.asset.id] = outcome.asset
    order.push(id)
    if (outcome.node.type === "frame") frameChildren.set(id, [])
    const frameId = typeof element.frameId === "string" && element.frameId.length > 0 ? element.frameId : undefined
    if (frameId) frameOf.set(id, frameId)
  }

  for (const member of order) {
    const frameId = frameOf.get(member)
    if (!frameId) continue
    const children = frameChildren.get(frameId)
    if (!children) {
      approximated.add(`frame membership dropped for "${member}" (missing frame)`)
      continue
    }
    children.push(member)
    nodes[member] = { ...nodes[member], parentId: frameId } as DesignNodeV1
  }
  for (const [frameId, childIds] of frameChildren) {
    const frame = nodes[frameId]
    if (frame && frame.type === "frame") nodes[frameId] = { ...frame, childIds }
  }

  if (scene.elements.some((element) => typeof element.roughness === "number" && element.roughness !== 0)) {
    approximated.add("hand-drawn roughness flattened")
  }
  if (scene.elements.some((element) => typeof element.fillStyle === "string" && element.fillStyle !== "solid")) {
    approximated.add("fill styles flattened")
  }

  const candidate: DesignDocumentV1 = {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    id: options.id ?? "legacy-import",
    name: options.name ?? "Imported sketch",
    rootIds: order.filter((id) => nodes[id]?.parentId === null),
    nodes,
    assets: Object.keys(assets).length > 0 ? assets : undefined,
  }
  // The importer's own output must pass the canonical validation gate; a
  // failure here is a converter bug, not a silent partial document.
  return { document: parseDesignDocument(candidate), skipped, approximated: [...approximated] }
}

function parseScene(raw: unknown): LegacyScene {
  if (typeof raw !== "object" || raw === null) {
    throw new DesignDocumentError("invalid-legacy-snapshot", "legacy sketch is not an object")
  }
  const elements = (raw as { elements?: unknown }).elements
  if (!Array.isArray(elements)) {
    throw new DesignDocumentError("invalid-legacy-snapshot", "legacy sketch has no elements array")
  }
  const files = (raw as { files?: unknown }).files
  return {
    elements: elements.filter((element): element is LegacyElement => typeof element === "object" && element !== null),
    files: typeof files === "object" && files !== null ? (files as LegacyScene["files"]) : undefined,
  }
}

function convertElement(
  element: LegacyElement,
  id: string,
  type: string,
  files: NonNullable<LegacyScene["files"]>,
  approximated: Set<string>,
): { node: DesignNodeV1; asset?: DesignAssetV1 } | undefined {
  const width = Math.abs(number(element.width) ?? 0)
  const height = Math.abs(number(element.height) ?? 0)
  const base = {
    id,
    name: id,
    parentId: null,
    visible: true,
    locked: element.locked === true,
    transform: {
      x: number(element.x) ?? 0,
      y: number(element.y) ?? 0,
      width,
      height,
      rotation: degrees(number(element.angle) ?? 0),
    },
  }
  const style = elementStyle(element)
  switch (type) {
    case "rectangle":
      return { node: { ...base, type: "rectangle", style } }
    case "ellipse":
      return { node: { ...base, type: "ellipse", style } }
    case "diamond":
      return { node: { ...base, type: "path", d: diamondPath(width, height), style } }
    case "text":
      return { node: { ...base, type: "text", text: string(element.text) ?? "", style } }
    case "line":
    case "arrow": {
      const points = normalizePoints(element.points)
      if (points.length < 2) return undefined
      if (type === "arrow") approximated.add("arrow heads dropped (converted to lines)")
      return {
        node: {
          ...base,
          type: "line",
          points,
          stroke: string(element.strokeColor) ?? "#18181b",
          strokeWidth: positive(element.strokeWidth) ?? 2,
        },
      }
    }
    case "freedraw": {
      const points = normalizePoints(element.points)
      if (points.length < 2) return undefined
      return { node: { ...base, type: "path", d: polylinePath(points), style } }
    }
    case "image": {
      const assetId = string(element.fileId) ?? id
      const file = files[assetId]
      if (!file) approximated.add("images without embedded data show a placeholder")
      const asset: DesignAssetV1 | undefined = file
        ? { id: assetId, kind: "image", mimeType: string(file.mimeType), source: string(file.dataURL) }
        : undefined
      return { node: { ...base, type: "image", assetId }, asset }
    }
    case "frame":
      return { node: { ...base, type: "frame", childIds: [] } }
    default:
      return undefined
  }
}

function elementStyle(element: LegacyElement): DesignStyleV1 {
  const fill = string(element.backgroundColor)
  const opacity = number(element.opacity)
  return {
    fill: fill === "transparent" ? undefined : fill,
    stroke: string(element.strokeColor),
    strokeWidth: positive(element.strokeWidth),
    opacity: opacity === undefined ? undefined : Math.min(1, Math.max(0, opacity / 100)),
  }
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function positive(value: unknown): number | undefined {
  const parsed = number(value)
  return parsed === undefined ? undefined : Math.abs(parsed)
}

/** Excalidraw stores rotation in radians; the canonical format uses degrees. */
function degrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function normalizePoints(value: unknown): DesignPointV1[] {
  if (!Array.isArray(value)) return []
  const points: DesignPointV1[] = []
  for (const entry of value) {
    if (Array.isArray(entry)) {
      const [x, y] = entry
      if (typeof x === "number" && typeof y === "number") points.push({ x, y })
      continue
    }
    if (typeof entry === "object" && entry !== null) {
      const point = entry as LegacyPoint & { x?: unknown; y?: unknown }
      if (typeof point.x === "number" && typeof point.y === "number") points.push({ x: point.x, y: point.y })
    }
  }
  return points
}

function polylinePath(points: readonly DesignPointV1[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
}

function diamondPath(width: number, height: number): string {
  return `M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z`
}
