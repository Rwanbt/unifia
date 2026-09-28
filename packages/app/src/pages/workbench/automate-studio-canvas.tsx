/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio canvas — the center pane of the Automate surface.
 *
 * Phase 8 progress:
 * - Slice 1: render the selected workflow's steps as a node graph
 *   with pan/zoom and a deterministic layout.
 * - Slice 2: expose `selectedNodeId` + `onSelectNode` so a parent
 *   can drive both the visual selection and a sibling Inspector.
 * - Slice 3: drag-to-move. Each node can be dragged with the left
 *   mouse button; the new position overrides the deterministic
 *   layout. Positions live in component state (the `<g>` transform
 *   handles pan/zoom separately), so a future slice can lift them
 *   to the parent for persistence without changing the canvas
 *   contract.
 *
 * Interactions:
 * - Pan: left-button drag on the background, or hold Space + drag.
 * - Zoom: Ctrl/Cmd + mouse wheel (range 0.5 - 2.0).
 * - Reset: double-click on the background.
 * - Selection: click on a node fires `onSelectNode`.
 * - Drag-to-move: pointerdown on a node + drag = move; pointerup
 *   releases. The drag deltas are divided by the current zoom so
 *   the node tracks the cursor in screen pixels regardless of the
 *   pan/zoom transform.
 *
 * Accessibility: the canvas exposes a single `role="img"` element
 * with an `aria-label` summarising the workflow (id, step count,
 * approval count) and a parallel hidden `<ol>` listing every step
 * so screen readers don't have to descend into the SVG subtree.
 * Keyboard users can Tab through the reset/zoom buttons instead
 * of navigating pixels.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import {
  BRANCH_PORT_OFFSET,
  PORT_HIT_RADIUS,
  PORT_RADIUS,
  closestInputPortDistance,
  computeZoomToFit,
  hasEdge,
  isBranchingFamily,
  layoutWorkflowSteps,
  mergeEndpoints,
  nearestInputPortId,
  outputPortDy,
  outputPortsFor,
  type LaidOutGraph,
  type LaidOutNode,
  type NodePositionOverride,
  type UserEdge,
  type UserEdgeKind,
} from "./automate-graph-layout"
import type { WorkflowStepSummary } from "./automate-workflow-model"
import { AutomateStudioMinimap } from "./automate-studio-minimap"

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

export type AutomateStudioCanvasProps = {
  /** Sequential steps extracted from the selected workflow. */
  readonly steps: readonly WorkflowStepSummary[]
  /** Optional id used for ARIA labels (the workflow definition id). */
  readonly definitionId?: string
  /** Width of the viewport pane in CSS pixels. Drives the SVG `viewBox`. */
  readonly width: number
  /** Height of the viewport pane in CSS pixels. */
  readonly height: number
  /**
   * Externally-controlled selected node id. The canvas highlights the
   * node whose id matches this prop. Parent components (e.g. the
   * Automate surface) own the selection state so they can drive both
   * the canvas visual feedback and a sibling Inspector pane from a
   * single source. When undefined, no node is selected.
   */
  readonly selectedNodeId?: string
  /**
   * Fires when the user clicks a node (with the node id) or the
   * canvas background (with `undefined`). The parent is expected to
   * mirror the value back via `selectedNodeId`.
   */
  readonly onSelectNode?: (nodeId: string | undefined) => void
  /**
   * Externally-controlled position override map (slice 3 drag-to-move).
   * When a node id appears here, the canvas renders it at the supplied
   * (x, y) instead of the deterministic layout position. The parent
   * (Automate surface) owns this map so the Inspector pane can read
   * the same coordinates and so future slices can persist them.
   */
  readonly positions?: Readonly<Record<string, NodePositionOverride>>
  /**
   * Fires whenever a drag updates the position override map. The
   * parent is expected to mirror the value back via `positions`. The
   * callback is invoked on every pointermove during a drag, so the
   * parent should keep the mirror update cheap (a SolidJS signal
   * setter is fine).
   */
  readonly onPositionsChange?: (positions: Record<string, NodePositionOverride>) => void
  /**
   * Externally-controlled user-added edges (slice 4 port connectors).
   * The canvas renders these in addition to the synthetic sequential
   * edges from `layoutWorkflowSteps`. The parent (AutomateSurface)
   * owns this list so the Inspector pane can read the same edges and
   * a future slice can persist them.
   */
  readonly edges?: readonly UserEdge[]
  /**
   * Fires when the user adds or removes a user edge via drag-port-to-
   * port or click-on-edge. The parent mirrors the value back via
   * `edges`.
   */
  readonly onEdgesChange?: (edges: readonly UserEdge[]) => void
  /** Extra buttons appended to the zoom pill (phones: Debug and Nodes, ADR-086). */
  readonly toolsExtra?: JSX.Element
  /** A run is in flight: cards drop their "Idle" state. */
  readonly running?: boolean
}

export function AutomateStudioCanvas(props: AutomateStudioCanvasProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const graph = createMemo<LaidOutGraph>(() => layoutWorkflowSteps(props.steps))
  const [panX, setPanX] = createSignal(0)
  const [panY, setPanY] = createSignal(0)
  const [zoom, setZoom] = createSignal(1)
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  const [panDragging, setPanDragging] = createSignal<{ x: number; y: number } | undefined>()
  /** Active node drag, if any. Stored separately from pan so the two handlers don't fight. */
  const [nodeDragging, setNodeDragging] = createSignal<{ nodeId: string; startClientX: number; startClientY: number; startX: number; startY: number } | undefined>()
  /** Active port-to-port connection drag. Stores the source node id, the output port kind, and the cursor position in graph coords. */
  const [connecting, setConnecting] = createSignal<{ fromNodeId: string; fromKind: UserEdgeKind; cursorX: number; cursorY: number } | undefined>()
  let svgRef: SVGSVGElement | undefined
  let frameRef: HTMLDivElement | undefined
  // The studio canvas fills the flow, so the viewBox follows the element's
  // real size (1 SVG unit = 1 CSS px, which clientToGraphCoords relies on).
  // Zero until the observer measures the pane: framing on the fallback
  // size would fit the flow to the wrong box.
  const [size, setSize] = createSignal({ width: 0, height: 0 })
  const paneWidth = () => size().width || props.width
  const paneHeight = () => size().height || props.height
  onMount(() => {
    if (!frameRef || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(frameRef)
    onCleanup(() => observer.disconnect())
  })
  const selectedNodeId = (): string | undefined => props.selectedNodeId
  const selectNode = (id: string | undefined): void => props.onSelectNode?.(id)
  /** Read-only effective override map: parent-controlled or empty. */
  const overrides = (): Readonly<Record<string, NodePositionOverride>> => props.positions ?? {}
  /** Effective position accessor: parent-controlled drag position wins over the deterministic layout. */
  const effectiveX = (node: LaidOutNode): number => overrides()[node.id]?.x ?? node.x
  const effectiveY = (node: LaidOutNode): number => overrides()[node.id]?.y ?? node.y
  /** User-added edges (parent-controlled). */
  const userEdges = (): readonly UserEdge[] => props.edges ?? []

  function onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    const next = clampZoom(zoom() + direction)
    setZoom(next)
  }

  function onBackgroundPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    if (!spaceHeld() && !(event.target as Element).hasAttribute?.("data-canvas-background")) return
    setPanDragging({ x: event.clientX, y: event.clientY })
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  }

  function startNodeDrag(node: LaidOutNode, event: PointerEvent): void {
    if (event.button !== 0) return
    setNodeDragging({
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: effectiveX(node),
      startY: effectiveY(node),
    })
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    selectNode(node.id)
  }

  function startPortDrag(node: LaidOutNode, kind: UserEdgeKind, event: PointerEvent): void {
    if (event.button !== 0) return
    event.stopPropagation()
    const graphCoords = clientToGraphCoords(event.clientX, event.clientY)
    if (!graphCoords) return
    setConnecting({ fromNodeId: node.id, fromKind: kind, cursorX: graphCoords.x, cursorY: graphCoords.y })
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  }

  /**
   * Convert a pointer event's client coordinates to graph coordinates
   * (the inner `<g transform>` local space). Accounts for the SVG
   * bounding rect, the current pan, and the zoom. Returns undefined
   * when the SVG ref is missing (e.g. first paint before ref is set).
   */
  function clientToGraphCoords(clientX: number, clientY: number): { x: number; y: number } | undefined {
    const svg = svgRef
    if (!svg) return undefined
    const rect = svg.getBoundingClientRect()
    const scale = zoom()
    if (scale === 0) return undefined
    return {
      x: (clientX - rect.left - panX()) / scale,
      y: (clientY - rect.top - panY()) / scale,
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const nodeDrag = nodeDragging()
    if (nodeDrag) {
      // Screen deltas divided by current zoom = local SVG deltas.
      const scale = zoom()
      if (scale === 0) return
      const nextX = nodeDrag.startX + (event.clientX - nodeDrag.startClientX) / scale
      const nextY = nodeDrag.startY + (event.clientY - nodeDrag.startClientY) / scale
      const next = { ...overrides(), [nodeDrag.nodeId]: { x: nextX, y: nextY } }
      props.onPositionsChange?.(next)
      return
    }
    const conn = connecting()
    if (conn) {
      const graphCoords = clientToGraphCoords(event.clientX, event.clientY)
      if (graphCoords) setConnecting({ fromNodeId: conn.fromNodeId, fromKind: conn.fromKind, cursorX: graphCoords.x, cursorY: graphCoords.y })
      return
    }
    const panDrag = panDragging()
    if (!panDrag) return
    setPanX(panX() + (event.clientX - panDrag.x))
    setPanY(panY() + (event.clientY - panDrag.y))
    setPanDragging({ x: event.clientX, y: event.clientY })
  }

  function onPointerUp(event: PointerEvent): void {
    const conn = connecting()
    if (conn) {
      ;(event.currentTarget as Element).releasePointerCapture?.(event.pointerId)
      // Hit-test: find the closest input port. If within PORT_HIT_RADIUS
      // graph units, create the edge. Otherwise cancel silently.
      const graphCoords = clientToGraphCoords(event.clientX, event.clientY)
      if (graphCoords) {
        // R4: keep the drop zone >= 24 CSS px wide at any zoom by
        // growing the graph-space radius when the user zooms out.
        const hitRadius = Math.max(PORT_HIT_RADIUS, PORT_HIT_RADIUS / zoom())
        const dist = closestInputPortDistance(graph(), overrides(), graphCoords.x, graphCoords.y)
        if (dist <= hitRadius) {
          const targetId = nearestInputPortId(graph(), overrides(), graphCoords.x, graphCoords.y)
          if (targetId && targetId !== conn.fromNodeId && !hasEdge(userEdges(), conn.fromNodeId, targetId)) {
            const next = [...userEdges(), { from: conn.fromNodeId, to: targetId, kind: conn.fromKind }]
            props.onEdgesChange?.(next)
          }
        }
      }
      setConnecting(undefined)
      return
    }
    if (nodeDragging()) {
      ;(event.currentTarget as Element).releasePointerCapture?.(event.pointerId)
      setNodeDragging(undefined)
      return
    }
    if (!panDragging()) return
    ;(event.currentTarget as Element).releasePointerCapture?.(event.pointerId)
    setPanDragging(undefined)
  }

  function onDoubleClick(event: MouseEvent): void {
    if (!(event.target as Element).hasAttribute?.("data-canvas-background")) return
    setPanX(0)
    setPanY(0)
    setZoom(1)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === " " && !spaceHeld()) {
      setSpaceHeld(true)
      event.preventDefault()
    }
    if (event.key === "Escape" && selectedNodeId()) {
      selectNode(undefined)
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === " ") setSpaceHeld(false)
  }

  function onZoomIn(): void {
    setZoom(clampZoom(zoom() + ZOOM_STEP))
  }
  function onZoomOut(): void {
    setZoom(clampZoom(zoom() - ZOOM_STEP))
  }
  function onReset(): void {
    setPanX(0)
    setPanY(0)
    setZoom(1)
  }
  function onZoomToFit(): void {
    // Slice 8.9 + ADR-086: fit the whole graph (drag overrides included) in
    // the live pane, never above 100 % so a short flow keeps the
    // reference's card size, and centre it.
    const width = paneWidth()
    const height = paneHeight()
    const fit = computeZoomToFit(graph(), width, height)
    const nextZoom = clampZoom(Math.min(1, fit.zoom))
    setZoom(nextZoom)
    setPanX((width - graph().width * nextZoom) / 2)
    setPanY((height - graph().height * nextZoom) / 2)
  }
  // Frame the flow once per definition, as soon as the pane has a size.
  let fittedFor: string | undefined
  createEffect(() => {
    const key = `${props.definitionId ?? ""}:${props.steps.length > 0}`
    const { width } = size()
    if (width <= 0 || props.steps.length === 0 || fittedFor === key) return
    fittedFor = key
    onZoomToFit()
  })

  const approvalCount = createMemo(() => props.steps.filter((step) => step.requiresApproval).length)
  const summary = createMemo(() => {
    const idPart = props.definitionId ? `${props.definitionId} — ` : ""
    return `${idPart}${props.steps.length} steps · ${approvalCount()} approvals`
  })

  return (
    <div ref={frameRef} data-automate-studio-canvas>
      <svg
        ref={svgRef}
        role="img"
        aria-label={t("workbench.automate.canvas.workflowLabel", { summary: summary() })}
        data-automate-studio-svg
        viewBox={`0 0 ${Math.max(paneWidth(), 1)} ${Math.max(paneHeight(), 1)}`}
        preserveAspectRatio="xMinYMin meet"
        onWheel={onWheel}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        tabIndex={0}
      >
        <g
          transform={`translate(${panX()} ${panY()}) scale(${zoom()})`}
          data-canvas-background=""
          data-canvas-pan={`${Math.round(panX())},${Math.round(panY())}`}
          data-canvas-zoom={zoom().toFixed(2)}
        >
          <rect x={-10000} y={-10000} width={20000} height={20000} fill="transparent" data-canvas-background="" />
          <Show when={graph().edges.length > 0 || userEdges().length > 0}>
            <g data-automate-studio-edges>
              <For each={mergeEndpoints(graph(), overrides(), userEdges())}>
                {(endpoints) => (
                  <g data-automate-studio-edge-group={`${endpoints.from}->${endpoints.to}`}>
                    <path
                      d={edgePath(endpoints.x1, endpoints.y1, endpoints.x2, endpoints.y2)}
                      fill="none"
                      data-automate-studio-edge={`${endpoints.from}->${endpoints.to}`}
                      data-automate-studio-edge-user={endpoints.user ? "true" : "false"}
                      data-automate-studio-edge-kind={endpoints.kind}
                      style={{ cursor: endpoints.user ? "pointer" : "default" }}
                      onClick={(event) => {
                        if (!endpoints.user) return
                        event.stopPropagation()
                        const next = userEdges().filter((edge) => !(edge.from === endpoints.from && edge.to === endpoints.to))
                        props.onEdgesChange?.(next)
                      }}
                    />
                    <Show when={endpoints.kind !== "flow"}>
                      <text
                        x={(endpoints.x1 + endpoints.x2) / 2}
                        y={(endpoints.y1 + endpoints.y2) / 2 - 4}
                        text-anchor="middle"
                        data-automate-studio-edge-label
                      >
                        {endpoints.kind === "branch-true"
                          ? t("workbench.automate.canvas.edgeBranchTrue")
                          : t("workbench.automate.canvas.edgeBranchFalse")}
                      </text>
                    </Show>
                  </g>
                )}
              </For>
            </g>
          </Show>
          <Show when={connecting()}>
            {(conn) => {
              const fromNode = graph().nodes.find((n) => n.id === conn().fromNodeId)
              if (!fromNode) return null
              const fx = effectiveX(fromNode) + fromNode.width
              const fy = effectiveY(fromNode) + fromNode.height / 2 + outputPortDy(fromNode.family, conn().fromKind)
              return <path d={edgePath(fx, fy, conn().cursorX, conn().cursorY)} fill="none" data-automate-studio-ghost-edge />
            }}
          </Show>
          <For each={graph().nodes}>
            {(node) => (
              <NodeRect
                node={node}
                x={effectiveX(node)}
                y={effectiveY(node)}
                selected={selectedNodeId() === node.id}
                idle={!props.running}
                onSelect={() => selectNode(node.id)}
                onPointerDown={(event) => startNodeDrag(node, event)}
                onOutputPortPointerDown={(kind, event) => startPortDrag(node, kind, event)}
              />
            )}
          </For>
        </g>
      </svg>
      <Show when={props.steps.length === 0}>
        <div data-automate-studio-canvas-empty>
          <p>{t("workbench.automate.canvas.empty")}</p>
        </div>
      </Show>
      <div data-automate-studio-minimap-wrapper>
        <AutomateStudioMinimap
          graph={graph()}
          viewportWidth={paneWidth()}
          viewportHeight={paneHeight()}
          viewport={{ panX: panX(), panY: panY(), zoom: zoom() }}
          positions={overrides()}
          onJumpTo={(jPanX, jPanY, jZoom) => {
            setPanX(jPanX)
            setPanY(jPanY)
            setZoom(clampZoom(jZoom))
          }}
        />
      </div>
      <div data-automate-studio-tools>
        <button
          type="button"
          title={t("workbench.automate.canvas.zoomOut")}
          aria-label={t("workbench.automate.canvas.zoomOut")}
          onClick={onZoomOut}
        >
          −
        </button>
        <button
          type="button"
          data-automate-studio-zoom-level
          title={t("workbench.automate.canvas.resetView")}
          aria-label={t("workbench.automate.canvas.resetView")}
          aria-live="polite"
          onClick={onReset}
        >
          {Math.round(zoom() * 100)}%
        </button>
        <button
          type="button"
          title={t("workbench.automate.canvas.zoomIn")}
          aria-label={t("workbench.automate.canvas.zoomIn")}
          onClick={onZoomIn}
        >
          +
        </button>
        <button
          type="button"
          data-automate-studio-fit
          title={t("workbench.automate.canvas.zoomToFit")}
          aria-label={t("workbench.automate.canvas.zoomToFit")}
          onClick={onZoomToFit}
        >
          {props.toolsExtra ? "⧫" : "Fit"}
        </button>
        {props.toolsExtra}
      </div>
      <ol class="sr-only" aria-label={t("workbench.automate.canvas.stepsLabel")}>
        <For each={props.steps}>
          {(step) => (
            <li>
              {step.id} — {step.label}
              {step.requiresApproval ? ` (${t("workbench.automate.canvas.approvalTag")})` : ""}
            </li>
          )}
        </For>
      </ol>
    </div>
  )
}

type NodeRectProps = {
  readonly node: LaidOutNode
  /** Effective x position (layout, possibly overridden by user drag). */
  readonly x: number
  /** Effective y position (layout, possibly overridden by user drag). */
  readonly y: number
  readonly selected: boolean
  /** No run in flight: the card shows the reference's "Idle" state. */
  readonly idle: boolean
  readonly onSelect: () => void
  readonly onPointerDown: (event: PointerEvent) => void
  readonly onOutputPortPointerDown: (kind: UserEdgeKind, event: PointerEvent) => void
}

/** Reference category shown in the card footer, from the family prefix. */
const FAMILY_CATEGORY: Readonly<Record<string, string>> = {
  trigger: "Triggers",
  control: "Flow",
  tool: "Tools",
  human: "Human",
  wait: "Flow",
}

/** Two-letter badge of the card (the reference shows "GH", "AI", "IF"…). */
function familyBadge(family: string | undefined): string {
  if (!family) return "··"
  const leaf = family.split(".").at(-1) ?? family
  return leaf.slice(0, 2).toUpperCase()
}

/**
 * Node card (`.a60-node`, ADR-086). The body is HTML inside a
 * `foreignObject` so the reference's card CSS applies as is; the ports stay
 * SVG circles because the connection hit-test works in graph space.
 */
function NodeRect(props: NodeRectProps): JSX.Element {
  const t = useLanguage().t
  const category = () => FAMILY_CATEGORY[props.node.family?.split(".")[0] ?? ""] ?? "Steps"
  return (
    <g
      transform={`translate(${props.x} ${props.y})`}
      data-automate-studio-node={props.node.id}
      data-automate-studio-node-selected={props.selected ? "true" : "false"}
      data-automate-studio-node-approval={props.node.requiresApproval ? "true" : "false"}
      data-automate-studio-node-x={Math.round(props.x)}
      data-automate-studio-node-y={Math.round(props.y)}
      onPointerDown={props.onPointerDown}
      onClick={(event) => {
        event.stopPropagation()
        props.onSelect()
      }}
    >
      <foreignObject width={props.node.width} height={props.node.height} data-automate-studio-node-shell>
        <div data-automate-studio-node-card data-selected={props.selected ? "" : undefined}>
          <div data-automate-studio-node-top>
            <div data-automate-studio-node-icon>{familyBadge(props.node.family)}</div>
            <div data-automate-studio-node-copy>
              <b>{props.node.id}</b>
              <small>{props.node.label}</small>
            </div>
            {/* Branching cards carry their true/false port labels in this corner, like the reference. */}
            <span data-automate-studio-node-state>
              {props.idle && !isBranchingFamily(props.node.family) ? t("automate.studio.node.idle") : ""}
            </span>
          </div>
          <div data-automate-studio-node-foot>
            <span>{category()}</span>
            <Show when={props.node.requiresApproval}>
              <span data-automate-studio-node-risk>{t("workbench.automate.canvas.approvalTag")}</span>
            </Show>
          </div>
        </div>
      </foreignObject>
      <circle
        cx={0}
        cy={props.node.height / 2}
        r={PORT_RADIUS}
        data-automate-studio-port={`${props.node.id}:in`}
        data-port-kind="in"
        aria-label={t("workbench.automate.canvas.portInput")}
      />
      <For each={outputPortsFor(props.node.family)}>
        {(port) => (
          <circle
            cx={props.node.width}
            cy={props.node.height / 2 + port.dy}
            r={PORT_RADIUS}
            data-automate-studio-port={`${props.node.id}:out:${port.kind}`}
            data-port-kind={port.kind}
            aria-label={
              port.kind === "branch-true"
                ? t("workbench.automate.canvas.portTrue")
                : port.kind === "branch-false"
                  ? t("workbench.automate.canvas.portFalse")
                  : t("workbench.automate.canvas.portOutput")
            }
            onPointerDown={(event) => {
              event.stopPropagation()
              props.onOutputPortPointerDown(port.kind, event)
            }}
          />
        )}
      </For>
      <Show when={isBranchingFamily(props.node.family)}>
        <text
          x={props.node.width - 16}
          y={props.node.height / 2 - BRANCH_PORT_OFFSET + 3}
          text-anchor="end"
          data-automate-studio-port-label
        >
          {t("workbench.automate.canvas.edgeBranchTrue")}
        </text>
        <text
          x={props.node.width - 16}
          y={props.node.height / 2 + BRANCH_PORT_OFFSET + 3}
          text-anchor="end"
          data-automate-studio-port-label
        >
          {t("workbench.automate.canvas.edgeBranchFalse")}
        </text>
      </Show>
    </g>
  )
}

function clampZoom(value: number): number {
  if (value < MIN_ZOOM) return MIN_ZOOM
  if (value > MAX_ZOOM) return MAX_ZOOM
  return Number(value.toFixed(2))
}

/** Reference control-point offset of an edge's cubic bezier (`.a60-edge`). */
const EDGE_CURVE = 54

/**
 * SVG path for an edge between two horizontally-aligned cards: from the
 * source's right edge to the target's left edge, with horizontal control
 * points like the reference.
 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(EDGE_CURVE, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}
