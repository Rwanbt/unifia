/* SPDX-License-Identifier: MIT */

import type KonvaNS from "konva"
import type { DesignCommand } from "../../model/commands"
import type { DesignDocumentV1, DesignNodeId, DesignNodeV1 } from "../../model/schema"
import { nodeMatrix } from "../geometry"
import { projectDocument, type DesignProjectionNode } from "../project"
import { designSnapThresholdPx, snapCandidates, snapRect, type DesignSnapGuide } from "../snapping"
import { panBy, zoomAt, type DesignViewport } from "../viewport"
import { commitTransform, toKonvaAttrs } from "./attrs"

type KonvaModule = typeof KonvaNS
type KonvaNode = InstanceType<KonvaModule["Node"]>
type KonvaShape = InstanceType<KonvaModule["Shape"]>
type KonvaContainer = InstanceType<KonvaModule["Container"]>

export type KonvaCanvasOptions = {
  container: HTMLDivElement
  onSelect: (id: DesignNodeId | undefined) => void
  onCommand: (command: DesignCommand) => void
  onViewport: (viewport: DesignViewport) => void
}

export type KonvaCanvasHandle = {
  sync: (document: DesignDocumentV1, selection: readonly DesignNodeId[], viewport: DesignViewport) => void
  destroy: () => void
}

const frameFill = "#ffffff"
const frameStroke = "#d4d4d8"
const shapeFill = "#e4e4e7"
const strokeColor = "#18181b"
const placeholderFill = "#f4f4f5"
const placeholderStroke = "#a1a1aa"
const zoomFactor = 1.1
const guideStroke = "#2563eb"
const guideExtent = 5000

/**
 * Imperative Konva adapter. Konva is loaded lazily so it never reaches the
 * app bundle unless Design mode mounts (ADR-039 section 7), and no Konva
 * object ever leaves this module: the caller only sees canonical documents,
 * commands and viewport state.
 */
export async function createKonvaCanvas(options: KonvaCanvasOptions): Promise<KonvaCanvasHandle> {
  const { default: Konva } = await import("konva")
  const stage = new Konva.Stage({
    container: options.container,
    width: options.container.clientWidth || 1,
    height: options.container.clientHeight || 1,
  })
  const content = new Konva.Layer()
  const overlay = new Konva.Layer()
  const transformer = new Konva.Transformer({
    rotateEnabled: true,
    borderStroke: "#2563eb",
    anchorStroke: "#2563eb",
    anchorSize: 8,
  })
  overlay.add(transformer)
  // Transient snap guides live in the overlay: rebuilt layers must never
  // carry them and the document never sees them (ADR-039 section 9).
  const guideX = new Konva.Line({ points: [0, 0, 0, 0], stroke: guideStroke, strokeWidth: 1, dash: [4, 4], listening: false, visible: false })
  const guideY = new Konva.Line({ points: [0, 0, 0, 0], stroke: guideStroke, strokeWidth: 1, dash: [4, 4], listening: false, visible: false })
  const guides = new Konva.Group({ listening: false })
  guides.add(guideX)
  guides.add(guideY)
  overlay.add(guides)
  stage.add(content)
  stage.add(overlay)

  const shapes = new Map<DesignNodeId, KonvaNode>()
  let document: DesignDocumentV1 | undefined
  let viewport: DesignViewport = { panX: 0, panY: 0, zoom: 1 }
  let selection: readonly DesignNodeId[] = []

  const applyViewport = () => {
    content.position({ x: viewport.panX, y: viewport.panY })
    content.scale({ x: viewport.zoom, y: viewport.zoom })
    overlay.position({ x: viewport.panX, y: viewport.panY })
    overlay.scale({ x: viewport.zoom, y: viewport.zoom })
  }

  const designIdOf = (node: KonvaNode | null): DesignNodeId | undefined => {
    let current = node
    while (current) {
      const id = current.getAttr("designId")
      if (typeof id === "string") return id
      current = current.getParent()
    }
    return undefined
  }

  const createShape = (node: DesignNodeV1): KonvaShape | undefined => {
    const attrs = toKonvaAttrs(node.transform)
    switch (node.type) {
      case "frame":
      case "group":
        return undefined
      case "rectangle":
        return new Konva.Rect({
          ...attrs,
          width: node.transform.width,
          height: node.transform.height,
          fill: node.style?.fill ?? shapeFill,
          stroke: node.style?.stroke,
          strokeWidth: node.style?.strokeWidth,
        })
      case "ellipse":
        return new Konva.Ellipse({
          x: attrs.x,
          y: attrs.y,
          rotation: attrs.rotation,
          radiusX: node.transform.width / 2,
          radiusY: node.transform.height / 2,
          fill: node.style?.fill ?? shapeFill,
          stroke: node.style?.stroke,
          strokeWidth: node.style?.strokeWidth,
        })
      case "line":
        return new Konva.Line({
          ...attrs,
          points: node.points.flatMap((point) => [point.x, point.y]),
          stroke: node.stroke ?? strokeColor,
          strokeWidth: node.strokeWidth ?? 2,
        })
      case "path":
        return new Konva.Path({
          ...attrs,
          data: node.d,
          fill: node.style?.fill,
          stroke: node.style?.stroke ?? strokeColor,
          strokeWidth: node.style?.strokeWidth ?? 2,
        })
      case "text":
        return new Konva.Text({
          ...attrs,
          text: node.text,
          width: node.transform.width,
          height: node.transform.height,
          fontSize: 14,
          fill: node.style?.fill ?? strokeColor,
        })
      case "image":
        // Asset loading is pending (ADR-039 section 20): an honest placeholder,
        // never a fabricated image.
        return new Konva.Rect({
          ...attrs,
          width: node.transform.width,
          height: node.transform.height,
          fill: placeholderFill,
          stroke: placeholderStroke,
          strokeWidth: 1,
          dash: [4, 4],
        })
    }
  }

  const buildNode = (item: DesignProjectionNode, parent: KonvaContainer) => {
    const node = item.node
    if (node.type === "frame" || node.type === "group") {
      const group = new Konva.Group(toKonvaAttrs(node.transform))
      group.setAttr("designId", item.id)
      group.draggable(!node.locked)
      wire(group)
      if (node.type === "frame") {
        group.add(
          new Konva.Rect({
            x: 0,
            y: 0,
            width: node.transform.width,
            height: node.transform.height,
            fill: frameFill,
            stroke: frameStroke,
            strokeWidth: 1,
            listening: false,
            name: "frame-background",
          }),
        )
      }
      shapes.set(item.id, group)
      parent.add(group)
      for (const child of item.children) buildNode(child, group)
      return
    }
    const shape = createShape(node)
    if (!shape) return
    shape.setAttr("designId", item.id)
    shape.draggable(!node.locked)
    wire(shape)
    shapes.set(item.id, shape)
    parent.add(shape)
  }

  const applySelection = () => {
    transformer.nodes([])
    if (!document || selection.length !== 1) return
    const id = selection[0]
    const node = id ? shapes.get(id) : undefined
    const canonical = id ? document.nodes[id] : undefined
    if (!node || !canonical || canonical.locked) return
    // Container resize semantics (children follow the new size) land with
    // the layer runtime; scaling a group now would visually lie.
    if (canonical.type === "frame" || canonical.type === "group") return
    transformer.nodes([node])
  }

  const rebuild = () => {
    content.destroyChildren()
    shapes.clear()
    hideGuides()
    if (!document) return
    for (const item of projectDocument(document)) buildNode(item, content)
    applySelection()
  }

  const commitNode = (node: KonvaNode) => {
    const id = node.getAttr("designId")
    if (typeof id !== "string" || !document) return
    const canonical = document.nodes[id]
    if (!canonical) return
    const transform = commitTransform(canonical.transform, {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
    })
    options.onCommand({ kind: "updateTransform", id, transform })
  }

  const showGuides = (items: readonly DesignSnapGuide[], offsetX: number, offsetY: number) => {
    for (const guide of items) {
      if (guide.axis === "x") {
        const x = guide.position + offsetX
        guideX.points([x, -guideExtent, x, guideExtent])
        guideX.visible(true)
        continue
      }
      const y = guide.position + offsetY
      guideY.points([-guideExtent, y, guideExtent, y])
      guideY.visible(true)
    }
    overlay.batchDraw()
  }

  const hideGuides = () => {
    if (!guideX.visible() && !guideY.visible()) return
    guideX.visible(false)
    guideY.visible(false)
    overlay.batchDraw()
  }

  /**
   * Guides are drawn in layer space, so only translation-only ancestors can
   * map to axis-aligned lines. A rotated ancestor keeps snapping (the domain
   * geometry is right) but skips the transient overlay rather than drawing a
   * misleading guide.
   */
  const parentOffsetOf = (id: DesignNodeId): { x: number; y: number } | undefined => {
    const doc = document
    const node = doc?.nodes[id]
    if (!doc || !node) return undefined
    if (node.parentId === null) return { x: 0, y: 0 }
    const matrix = nodeMatrix(doc, node.parentId)
    if (Math.abs(matrix.b) > 1e-9 || Math.abs(matrix.c) > 1e-9) return undefined
    return { x: matrix.e, y: matrix.f }
  }

  const snapWhileDragging = (node: KonvaNode) => {
    const id = node.getAttr("designId")
    if (typeof id !== "string" || !document) return
    const canonical = document.nodes[id]
    if (!canonical) return
    const width = canonical.transform.width
    const height = canonical.transform.height
    const rect = { x: node.x() - width / 2, y: node.y() - height / 2, width, height }
    const snapped = snapRect(rect, snapCandidates(document, id), designSnapThresholdPx / viewport.zoom)
    if (snapped.x !== rect.x || snapped.y !== rect.y) {
      node.position({ x: snapped.x + width / 2, y: snapped.y + height / 2 })
    }
    if (snapped.guides.length === 0) {
      hideGuides()
      return
    }
    const offset = parentOffsetOf(id)
    if (!offset) {
      hideGuides()
      return
    }
    showGuides(snapped.guides, offset.x, offset.y)
  }

  // `transformend` is fired by the Transformer with `_fire` (no bubbling), so
  // both events are wired per node; only `dragend` would reach the stage.
  const wire = (node: KonvaNode) => {
    node.on("dragstart", () => options.container.focus({ preventScroll: true }))
    node.on("dragmove", () => snapWhileDragging(node))
    node.on("dragend", () => {
      hideGuides()
      commitNode(node)
    })
    node.on("transformend", () => {
      commitNode(node)
      node.scaleX(1)
      node.scaleY(1)
    })
  }

  const isTransformerPart = (node: KonvaNode): boolean => {
    let current: KonvaNode | null = node
    while (current) {
      if (current === transformer) return true
      current = current.getParent()
    }
    return false
  }

  stage.on("mousedown touchstart", () => options.container.focus({ preventScroll: true }))

  stage.on("click tap", (event) => {
    if (event.target === stage) {
      options.onSelect(undefined)
      return
    }
    const target = event.target as KonvaNode
    if (isTransformerPart(target)) return
    options.onSelect(designIdOf(target))
  })

  let panning = false
  let lastPointer: { x: number; y: number } | undefined
  stage.on("pointerdown", (event) => {
    if (event.target !== stage) return
    panning = true
    lastPointer = stage.getPointerPosition() ?? undefined
  })
  stage.on("pointermove", () => {
    if (!panning) return
    const pointer = stage.getPointerPosition()
    if (!pointer || !lastPointer) return
    viewport = panBy(viewport, pointer.x - lastPointer.x, pointer.y - lastPointer.y)
    lastPointer = pointer
    applyViewport()
  })
  stage.on("pointerup pointercancel", () => {
    if (!panning) return
    panning = false
    lastPointer = undefined
    options.onViewport(viewport)
  })

  stage.on("wheel", (event) => {
    event.evt.preventDefault()
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const factor = event.evt.deltaY < 0 ? zoomFactor : 1 / zoomFactor
    viewport = zoomAt(viewport, factor, pointer)
    applyViewport()
    options.onViewport(viewport)
  })

  const observer = new ResizeObserver(() => {
    stage.size({ width: options.container.clientWidth || 1, height: options.container.clientHeight || 1 })
    content.batchDraw()
    overlay.batchDraw()
  })
  observer.observe(options.container)

  return {
    sync: (nextDocument, nextSelection, nextViewport) => {
      document = nextDocument
      selection = nextSelection
      viewport = nextViewport
      rebuild()
      applyViewport()
      content.batchDraw()
      overlay.batchDraw()
    },
    destroy: () => {
      observer.disconnect()
      stage.destroy()
    },
  }
}
