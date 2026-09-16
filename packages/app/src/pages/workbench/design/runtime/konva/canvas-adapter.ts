/* SPDX-License-Identifier: MIT */

import type KonvaNS from "konva"
import type { DesignCommand } from "../../model/commands"
import { movePathHandle, parsePath, pathHandles, serializePath, translatePath } from "../../model/path"
import type { DesignDocumentV1, DesignNodeId, DesignNodeV1, LineNodeV1, PathNodeV1 } from "../../model/schema"
import { applyInverseLinear, applyLinear, applyToPoint, identityMatrix, nodeMatrix, type DesignMatrix, type DesignPoint } from "../geometry"
import { projectDocument, type DesignProjectionNode } from "../project"
import { nodeWorldRect, parentMatrix, pickInRect, selectionMoves, toggleSelection } from "../selection"
import { designSnapThresholdPx, snapCandidates, snapRect, type DesignSnapGuide } from "../snapping"
import { draftRect, isDraftUsable, penPathData, type DesignDraft, type DesignPenPoint, type DesignTool } from "../tools"
import { panBy, screenToWorld, zoomAt, type DesignViewport } from "../viewport"
import { commitTransform, toKonvaAttrs } from "./attrs"

type KonvaModule = typeof KonvaNS
type KonvaNode = InstanceType<KonvaModule["Node"]>
type KonvaShape = InstanceType<KonvaModule["Shape"]>
type KonvaContainer = InstanceType<KonvaModule["Container"]>

export type KonvaCanvasOptions = {
  container: HTMLDivElement
  onSelect: (ids: readonly DesignNodeId[]) => void
  onCommand: (command: DesignCommand) => void
  onViewport: (viewport: DesignViewport) => void
  onCreate: (draft: DesignDraft) => void
}

export type KonvaCanvasHandle = {
  sync: (document: DesignDocumentV1, selection: readonly DesignNodeId[], viewport: DesignViewport, tool: DesignTool) => void
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
const anchorRadius = 5
const controlRadius = 4
const marqueeFill = "rgba(37, 99, 235, 0.12)"
// Screen-space pen gestures, converted to world units per zoom.
const penCloseThresholdPx = 10
const penHandleThresholdPx = 3

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
  // Anchor handles for polyline editing (line/path nodes, unrotated).
  const anchors = new Konva.Group()
  overlay.add(anchors)
  // Selection chrome (multi-select outlines) and the transient marquee are
  // editor state and never reach the document (ADR-039 section 9).
  const outlines = new Konva.Group({ listening: false })
  overlay.add(outlines)
  const marqueeRect = new Konva.Rect({
    stroke: guideStroke,
    strokeWidth: 1,
    fill: marqueeFill,
    visible: false,
    listening: false,
  })
  overlay.add(marqueeRect)
  stage.add(content)
  stage.add(overlay)

  const shapes = new Map<DesignNodeId, KonvaNode>()
  let document: DesignDocumentV1 | undefined
  let viewport: DesignViewport = { panX: 0, panY: 0, zoom: 1 }
  let selection: readonly DesignNodeId[] = []
  let tool: DesignTool = "select"
  let draft: DraftState | undefined
  let preview: KonvaShape | undefined
  let marquee: DesignPoint | undefined
  let dragGroup: DragGroup | undefined
  let penPress: { index: number; start: DesignPoint } | undefined
  let spaceHeld = false
  let suppressClick = false

  type DraftState =
    | { kind: "rectangle" | "ellipse" | "line"; start: DesignPoint }
    | { kind: "pen"; points: DesignPenPoint[] }

  type DragGroup = {
    /** Leader position at dragstart, in its parent's space. */
    start: DesignPoint
    parent: DesignMatrix
    members: { node: KonvaNode; id: DesignNodeId; start: DesignPoint }[]
  }

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
      group.draggable(tool === "select" && !node.locked)
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
    shape.draggable(tool === "select" && !node.locked)
    wire(shape)
    shapes.set(item.id, shape)
    parent.add(shape)
  }

  const applySelection = () => {
    transformer.nodes([])
    if (tool !== "select") return
    if (!document || selection.length !== 1) return
    const id = selection[0]
    const node = id ? shapes.get(id) : undefined
    const canonical = id ? document.nodes[id] : undefined
    if (!node || !canonical || canonical.locked) return
    // Container resize semantics (children follow the new size) land with
    // the layer runtime; scaling a group now would visually lie.
    if (canonical.type === "frame" || canonical.type === "group") return
    // Editable polylines already show anchors instead of the transformer; a
    // rotated one keeps rotation only — resize would need per-point scaling
    // the model cannot express (scale is never persisted).
    if (canonical.type === "line" || canonical.type === "path") {
      if (canonical.transform.rotation === 0) return
      transformer.resizeEnabled(false)
      transformer.nodes([node])
      return
    }
    transformer.resizeEnabled(true)
    transformer.nodes([node])
  }

  /** Multi-selection shows one world-space outline per node (the single-node
   *  case keeps the transformer, which already draws its own border). */
  const applyOutlines = () => {
    outlines.destroyChildren()
    if (!document || selection.length < 2) return
    for (const id of selection) {
      const box = nodeWorldRect(document, id)
      if (!box) continue
      outlines.add(
        new Konva.Rect({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          stroke: guideStroke,
          strokeWidth: 1,
          listening: false,
        }),
      )
    }
  }

  const anchorCircle = (point: DesignPoint, control = false) =>
    new Konva.Circle({
      x: point.x,
      y: point.y,
      radius: control ? controlRadius : anchorRadius,
      fill: control ? guideStroke : frameFill,
      stroke: control ? frameFill : guideStroke,
      strokeWidth: 1,
      draggable: true,
    })

  const addLineAnchors = (id: DesignNodeId, node: LineNodeV1, matrix: DesignMatrix, parent: DesignMatrix) => {
    const shape = shapes.get(id)
    const originX = parent.e + node.transform.x
    const originY = parent.f + node.transform.y
    const world = node.points.map((point) => applyToPoint(matrix, point))
    world.forEach((point, index) => {
      const circle = anchorCircle(point)
      circle.on("dragmove", () => {
        world[index] = { x: circle.x(), y: circle.y() }
        const local = world.map((entry) => ({ x: entry.x - originX, y: entry.y - originY }))
        shape?.setAttrs({ points: local.flatMap((entry) => [entry.x, entry.y]) })
        overlay.batchDraw()
      })
      circle.on("dragend", () => {
        world[index] = { x: circle.x(), y: circle.y() }
        options.onCommand({
          kind: "updatePoints",
          id,
          points: world.map((entry) => ({ x: entry.x - parent.e, y: entry.y - parent.f })),
        })
      })
      anchors.add(circle)
    })
  }

  const addPathAnchors = (id: DesignNodeId, node: PathNodeV1, matrix: DesignMatrix) => {
    const data = parsePath(node.d)
    if (!data) return
    const shape = shapes.get(id)
    const origin = { x: matrix.e, y: matrix.f }
    const handles = pathHandles(data)
    const world = handles.map((entry) => applyToPoint(matrix, entry.point))
    const guides: { anchor: number; index: number; line: InstanceType<KonvaModule["Line"]> }[] = []
    handles.forEach((entry, index) => {
      if (entry.handle.kind !== "control") return
      const anchor = handles.findIndex((candidate) => candidate.point === entry.anchor)
      if (anchor < 0) return
      const line = new Konva.Line({ points: [], stroke: guideStroke, strokeWidth: 1, dash: [3, 3], opacity: 0.6, listening: false })
      guides.push({ anchor, index, line })
      anchors.add(line)
    })
    const refresh = () => {
      for (const guide of guides) {
        const from = world[guide.anchor]
        const to = world[guide.index]
        if (from && to) guide.line.points([from.x, from.y, to.x, to.y])
      }
    }
    refresh()
    handles.forEach((entry, index) => {
      const circle = anchorCircle(world[index], entry.handle.kind === "control")
      circle.on("dragmove", () => {
        world[index] = { x: circle.x(), y: circle.y() }
        refresh()
        const local = { x: circle.x() - origin.x, y: circle.y() - origin.y }
        shape?.setAttrs({ data: serializePath(movePathHandle(data, entry.handle, local)) })
        overlay.batchDraw()
      })
      circle.on("dragend", () => {
        const local = { x: circle.x() - origin.x, y: circle.y() - origin.y }
        const moved = movePathHandle(data, entry.handle, local)
        options.onCommand({
          kind: "updatePath",
          id,
          data: translatePath(moved, { x: node.transform.x, y: node.transform.y }),
        })
      })
      anchors.add(circle)
    })
  }

  /**
   * Anchor handles: a line's points or a path's anchors and Bezier controls,
   * drawn world-space in the overlay and draggable. Dragging previews locally
   * (the node's own shape follows) and a finished drag commits one
   * `updatePoints` / `updatePath` command in parent space.
   */
  const applyAnchors = () => {
    anchors.destroyChildren()
    if (tool !== "select" || !document || selection.length !== 1) return
    const id = selection[0]
    const node = id ? document.nodes[id] : undefined
    if (!node || node.locked) return
    if (node.type !== "line" && node.type !== "path") return
    if (node.transform.rotation !== 0) return
    const matrix = nodeMatrix(document, id)
    if (Math.abs(matrix.b) > 1e-9 || Math.abs(matrix.c) > 1e-9) return
    if (node.type === "line") addLineAnchors(id, node, matrix, node.parentId === null ? identityMatrix : nodeMatrix(document, node.parentId))
    else addPathAnchors(id, node, matrix)
    overlay.batchDraw()
  }

  const rebuild = () => {
    content.destroyChildren()
    shapes.clear()
    hideGuides()
    if (!document) return
    for (const item of projectDocument(document)) buildNode(item, content)
    applySelection()
    applyAnchors()
    applyOutlines()
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

  const clearPreview = () => {
    preview?.destroy()
    preview = undefined
    overlay.batchDraw()
  }

  const showPreview = (shape: KonvaShape) => {
    preview?.destroy()
    preview = shape
    shape.setAttrs({ stroke: guideStroke, strokeWidth: 1, dash: [4, 4], listening: false, opacity: 0.9 })
    overlay.add(shape)
    overlay.batchDraw()
  }

  const showDraftPreview = (state: DraftState, hover: DesignPoint) => {
    if (state.kind === "pen") {
      const points: DesignPenPoint[] = [...state.points]
      const last = points[points.length - 1]
      // While a handle drag is in progress the cursor defines the tangent, not
      // a new anchor, so the hover point is only appended between points.
      if (!penPress && last && (Math.abs(last.x - hover.x) > 0.01 || Math.abs(last.y - hover.y) > 0.01)) {
        points.push({ x: hover.x, y: hover.y })
      }
      const data = penPathData(points)
      if (!data) return
      showPreview(new Konva.Path({ data: serializePath(data), fill: undefined }))
      return
    }
    if (state.kind === "line") {
      showPreview(new Konva.Line({ points: [state.start.x, state.start.y, hover.x, hover.y] }))
      return
    }
    const rect = draftRect(state.start, hover)
    if (state.kind === "ellipse") {
      showPreview(
        new Konva.Ellipse({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          radiusX: rect.width / 2,
          radiusY: rect.height / 2,
        }),
      )
      return
    }
    showPreview(new Konva.Rect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }))
  }

  const worldPoint = (): DesignPoint | undefined => {
    const pointer = stage.getPointerPosition()
    if (!pointer) return undefined
    return screenToWorld(viewport, pointer)
  }

  const finishDraft = (end?: DesignPoint) => {
    if (!draft) return
    if (draft.kind === "pen") {
      const finished: DesignDraft = { kind: "path", points: draft.points }
      draft = undefined
      penPress = undefined
      clearPreview()
      if (isDraftUsable(finished)) options.onCreate(finished)
      return
    }
    const target = end ?? draft.start
    const finished: DesignDraft =
      draft.kind === "line"
        ? { kind: "line", start: draft.start, end: target }
        : draft.kind === "ellipse"
          ? { kind: "ellipse", rect: draftRect(draft.start, target) }
          : { kind: "rectangle", rect: draftRect(draft.start, target) }
    draft = undefined
    clearPreview()
    if (isDraftUsable(finished)) options.onCreate(finished)
  }

  const cancelDraft = () => {
    if (!draft) return
    draft = undefined
    penPress = undefined
    clearPreview()
  }

  stage.on("pointerdown", () => {
    if (tool === "select") return
    const world = worldPoint()
    if (!world) return
    if (tool === "pen") {
      const points = draft?.kind === "pen" ? draft.points : []
      const first = points[0]
      // Clicking the first anchor closes the path: the start point is appended
      // as a final explicit segment, so the document never needs `Z`.
      if (first && points.length >= 2 && Math.hypot(first.x - world.x, first.y - world.y) <= penCloseThresholdPx / viewport.zoom) {
        draft = { kind: "pen", points: [...points, { x: first.x, y: first.y, handleIn: first.handleIn }] }
        finishDraft()
        return
      }
      const last = points[points.length - 1]
      if (last && Math.abs(last.x - world.x) < 0.01 && Math.abs(last.y - world.y) < 0.01) return
      const next: DraftState = { kind: "pen", points: [...points, { x: world.x, y: world.y }] }
      draft = next
      penPress = { index: next.points.length - 1, start: world }
      showDraftPreview(next, world)
      return
    }
    const next: DraftState = { kind: tool, start: world }
    draft = next
    showDraftPreview(next, world)
  })

  stage.on("pointermove", () => {
    if (!draft) return
    const world = worldPoint()
    if (!world) return
    if (draft.kind === "pen" && penPress) {
      // A click-drag on the fresh anchor sets symmetric handles (pen parity).
      const delta = { x: world.x - penPress.start.x, y: world.y - penPress.start.y }
      if (Math.hypot(delta.x, delta.y) > penHandleThresholdPx / viewport.zoom) {
        const index = penPress.index
        draft = {
          kind: "pen",
          points: draft.points.map((point, at) =>
            at === index ? { ...point, handleOut: delta, handleIn: { x: -delta.x, y: -delta.y } } : point,
          ),
        }
      }
    }
    showDraftPreview(draft, world)
  })

  stage.on("pointerup pointercancel", () => {
    if (!draft) return
    if (draft.kind === "pen") {
      penPress = undefined
      return
    }
    finishDraft(worldPoint() ?? draft.start)
  })

  // The pen finishes on Enter: Konva synthesises `dblclick` from any two
  // clicks inside its time window (no distance threshold), so a double-click
  // finish would cut a polyline short as soon as the user clicks twice fast.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancelDraft()
    if (event.key === "Enter") finishDraft()
    if (event.code === "Space") {
      // Space+drag is the pan gesture; keep it from scrolling the page.
      event.preventDefault()
      spaceHeld = true
      options.container.style.cursor = "grab"
    }
  }
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code !== "Space") return
    spaceHeld = false
    options.container.style.cursor = tool === "select" ? "" : "crosshair"
  }
  options.container.addEventListener("keydown", onKeyDown)
  options.container.addEventListener("keyup", onKeyUp)

  /**
   * Multi-selection dragging: the grabbed node (leader) drives, every other
   * member follows by the same world delta converted into its own parent
   * space. Snapping and outlines are single-selection affordances, so they
   * step aside while a group moves.
   */
  const beginDragGroup = (leader: KonvaNode) => {
    dragGroup = undefined
    if (tool !== "select" || !document || selection.length < 2) return
    const id = designIdOf(leader)
    if (id === undefined || !selection.includes(id)) return
    const parent = parentMatrix(document, id)
    if (!parent) return
    outlines.destroyChildren()
    dragGroup = {
      start: { x: leader.x(), y: leader.y() },
      parent,
      members: selection.flatMap((memberId) => {
        if (memberId === id) return []
        const member = shapes.get(memberId)
        return member ? [{ node: member, id: memberId, start: { x: member.x(), y: member.y() } }] : []
      }),
    }
  }

  const moveDragGroup = (leader: KonvaNode) => {
    const group = dragGroup
    if (!group || !document) return
    const world = applyLinear(group.parent, { x: leader.x() - group.start.x, y: leader.y() - group.start.y })
    for (const member of group.members) {
      const delta = applyInverseLinear(parentMatrix(document, member.id) ?? identityMatrix, world)
      member.node.position({ x: member.start.x + delta.x, y: member.start.y + delta.y })
    }
    overlay.batchDraw()
  }

  const commitDragGroup = (leader: KonvaNode) => {
    const group = dragGroup
    dragGroup = undefined
    if (!group || !document) return
    const world = applyLinear(group.parent, { x: leader.x() - group.start.x, y: leader.y() - group.start.y })
    const moves = selectionMoves(document, selection, world)
    if (moves.length > 0) options.onCommand({ kind: "translateNodes", moves })
  }

  // `transformend` is fired by the Transformer with `_fire` (no bubbling), so
  // both events are wired per node; only `dragend` would reach the stage.
  const wire = (node: KonvaNode) => {
    node.on("dragstart", () => {
      options.container.focus({ preventScroll: true })
      beginDragGroup(node)
    })
    node.on("dragmove", () => {
      if (dragGroup) {
        moveDragGroup(node)
        return
      }
      snapWhileDragging(node)
    })
    node.on("dragend", () => {
      hideGuides()
      if (dragGroup) {
        commitDragGroup(node)
        return
      }
      commitNode(node)
    })
    node.on("transformend", () => {
      commitNode(node)
      node.scaleX(1)
      node.scaleY(1)
    })
  }

  const isOverlayControl = (node: KonvaNode): boolean => {
    let current: KonvaNode | null = node
    while (current) {
      if (current === transformer || current === anchors) return true
      current = current.getParent()
    }
    return false
  }

  stage.on("mousedown touchstart", () => options.container.focus({ preventScroll: true }))

  stage.on("click tap", (event) => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    if (tool !== "select" || !document) return
    if (event.target === stage) {
      options.onSelect([])
      return
    }
    const target = event.target as KonvaNode
    if (isOverlayControl(target)) return
    const hit = designIdOf(target)
    if (hit === undefined) return
    const evt = event.evt as MouseEvent
    if (evt.metaKey || evt.ctrlKey || evt.shiftKey) {
      options.onSelect(toggleSelection(document, selection, hit))
      return
    }
    // A plain click keeps an existing multi-selection so the whole set can be
    // dragged as one; it replaces the selection otherwise (mockup parity).
    if (!selection.includes(hit)) options.onSelect([hit])
  })

  let panning = false
  let lastPointer: { x: number; y: number } | undefined
  stage.on("pointerdown", (event) => {
    if (tool !== "select") return
    const button = (event.evt as MouseEvent).button
    // Space or the middle button pans; a plain left drag on empty space is
    // the marquee (INTERACTIONS.md — Design).
    if (button === 1 || spaceHeld) {
      panning = true
      suppressClick = true
      lastPointer = stage.getPointerPosition() ?? undefined
      return
    }
    if (button !== 0 || event.target !== stage || !document) return
    const world = worldPoint()
    if (!world) return
    suppressClick = true
    marquee = world
    marqueeRect.setAttrs({ x: world.x, y: world.y, width: 0, height: 0, visible: true })
    overlay.batchDraw()
  })
  stage.on("pointermove", () => {
    if (panning) {
      const pointer = stage.getPointerPosition()
      if (!pointer || !lastPointer) return
      viewport = panBy(viewport, pointer.x - lastPointer.x, pointer.y - lastPointer.y)
      lastPointer = pointer
      applyViewport()
      return
    }
    if (!marquee) return
    const world = worldPoint()
    if (!world) return
    marqueeRect.setAttrs({
      x: Math.min(marquee.x, world.x),
      y: Math.min(marquee.y, world.y),
      width: Math.abs(world.x - marquee.x),
      height: Math.abs(world.y - marquee.y),
    })
    overlay.batchDraw()
  })
  stage.on("pointerup pointercancel", () => {
    if (panning) {
      panning = false
      lastPointer = undefined
      options.onViewport(viewport)
      return
    }
    if (!marquee) return
    marquee = undefined
    const rect = { x: marqueeRect.x(), y: marqueeRect.y(), width: marqueeRect.width(), height: marqueeRect.height() }
    marqueeRect.visible(false)
    overlay.batchDraw()
    if (!document) return
    // A zero-size drag is a plain click on empty space.
    if (rect.width < 2 && rect.height < 2) {
      options.onSelect([])
      return
    }
    options.onSelect(pickInRect(document, rect))
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
    sync: (nextDocument, nextSelection, nextViewport, nextTool) => {
      if (nextTool !== tool) cancelDraft()
      document = nextDocument
      selection = nextSelection
      viewport = nextViewport
      tool = nextTool
      options.container.style.cursor = tool === "select" ? "" : "crosshair"
      rebuild()
      applyViewport()
      // Synchronous draw: `batchDraw` defers to the next frame, which leaves a
      // window where the hit canvas is empty and an immediate click misses the
      // shapes it should hit (and falls through to the marquee).
      content.draw()
      overlay.draw()
    },
    destroy: () => {
      options.container.removeEventListener("keydown", onKeyDown)
      options.container.removeEventListener("keyup", onKeyUp)
      observer.disconnect()
      stage.destroy()
    },
  }
}
