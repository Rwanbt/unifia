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
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
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
  type EdgeEndpoint,
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
    // Slice 8.9: compute the pan + zoom that fits the entire
    // graph (including any drag-overridden positions) inside the
    // canvas viewport. We use the live CSS pixel size of the
    // SVG so the math adapts to the actual rendered pane, not
    // the configured `width` / `height` props.
    const svg = svgRef
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const fit = computeZoomToFit(graph(), rect.width || props.width, rect.height || props.height)
    setPanX(fit.panX)
    setPanY(fit.panY)
    setZoom(clampZoom(fit.zoom))
  }

  const approvalCount = createMemo(() => props.steps.filter((step) => step.requiresApproval).length)
  const summary = createMemo(() => {
    const idPart = props.definitionId ? `${props.definitionId} — ` : ""
    return `${idPart}${props.steps.length} steps · ${approvalCount()} approvals`
  })

  return (
    <div
      class="relative size-full overflow-hidden rounded-lg border border-border-base bg-background-stronger"
      data-automate-studio-canvas
    >
      <div class="absolute right-2 top-2 z-10 flex items-center gap-1 rounded border border-border-base bg-background-base p-1 text-11-regular shadow-sm">
        <button
          type="button"
          class="rounded px-2 py-1 hover:bg-background-stronger"
          aria-label={t("workbench.automate.canvas.zoomOut")}
          onClick={onZoomOut}
        >
          −
        </button>
        <span class="min-w-[3rem] text-center text-11-regular text-text-weak" aria-live="polite">
          {Math.round(zoom() * 100)}%
        </span>
        <button
          type="button"
          class="rounded px-2 py-1 hover:bg-background-stronger"
          aria-label={t("workbench.automate.canvas.zoomIn")}
          onClick={onZoomIn}
        >
          +
        </button>
        <button
          type="button"
          class="rounded px-2 py-1 hover:bg-background-stronger"
          aria-label={t("workbench.automate.canvas.zoomToFit")}
          onClick={onZoomToFit}
        >
          {t("workbench.automate.canvas.zoomToFit")}
        </button>
        <button
          type="button"
          class="rounded px-2 py-1 hover:bg-background-stronger"
          aria-label={t("workbench.automate.canvas.resetView")}
          onClick={onReset}
        >
          {t("workbench.automate.canvas.reset")}
        </button>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-label={t("workbench.automate.canvas.workflowLabel", { summary: summary() })}
        class="block size-full select-none"
        viewBox={`0 0 ${Math.max(props.width, 1)} ${Math.max(props.height, 1)}`}
        preserveAspectRatio="xMidYMid meet"
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
          <rect
            x={0}
            y={0}
            width={Math.max(graph().width, props.width)}
            height={Math.max(graph().height, props.height)}
            fill="transparent"
            data-canvas-background=""
          />
          <Show when={graph().edges.length > 0 || userEdges().length > 0}>
            <g data-automate-studio-edges>
              <For each={mergeEndpoints(graph(), overrides(), userEdges())}>
                {(endpoints) => (
                  <g data-automate-studio-edge-group={`${endpoints.from}->${endpoints.to}`}>
                    <path
                      d={edgePath(endpoints.x1, endpoints.y1, endpoints.x2, endpoints.y2)}
                      stroke="currentColor"
                      stroke-width={endpoints.user ? "2" : "1.5"}
                      fill="none"
                      class={edgeClass(endpoints)}
                      data-automate-studio-edge={`${endpoints.from}->${endpoints.to}`}
                      data-automate-studio-edge-user={endpoints.user ? "true" : "false"}
                      data-automate-studio-edge-kind={endpoints.kind}
                      marker-end="url(#automate-arrowhead)"
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
                        class="fill-text-weak pointer-events-none"
                        font-size="9"
                        font-weight={600}
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
              return (
                <path
                  d={edgePath(fx, fy, conn().cursorX, conn().cursorY)}
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-dasharray="4 4"
                  fill="none"
                  class="text-accent-base pointer-events-none"
                  data-automate-studio-ghost-edge
                />
              )
            }}
          </Show>
          <defs>
            <marker
              id="automate-arrowhead"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" class="text-border-base" />
            </marker>
          </defs>
          <For each={graph().nodes}>
            {(node) => (
              <NodeRect
                node={node}
                x={effectiveX(node)}
                y={effectiveY(node)}
                selected={selectedNodeId() === node.id}
                onSelect={() => selectNode(node.id)}
                onPointerDown={(event) => startNodeDrag(node, event)}
                onOutputPortPointerDown={(kind, event) => startPortDrag(node, kind, event)}
              />
            )}
          </For>
        </g>
      </svg>
      <Show when={props.steps.length === 0}>
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p class="text-12-regular text-text-weak">{t("workbench.automate.canvas.empty")}</p>
        </div>
      </Show>
      <div
        class="absolute bottom-2 right-2 z-10 h-28 w-40 rounded border border-border-base bg-background-base p-1 shadow-sm"
        data-automate-studio-minimap-wrapper
      >
        <AutomateStudioMinimap
          graph={graph()}
          viewportWidth={props.width}
          viewportHeight={props.height}
          viewport={{ panX: panX(), panY: panY(), zoom: zoom() }}
          positions={overrides()}
          onJumpTo={(jPanX, jPanY, jZoom) => {
            setPanX(jPanX)
            setPanY(jPanY)
            setZoom(clampZoom(jZoom))
          }}
        />
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
  readonly onSelect: () => void
  readonly onPointerDown: (event: PointerEvent) => void
  readonly onOutputPortPointerDown: (kind: UserEdgeKind, event: PointerEvent) => void
}

function NodeRect(props: NodeRectProps): JSX.Element {
  const t = useLanguage().t
  const fill = () => (props.selected ? "fill-background-base" : "fill-background-stronger")
  const stroke = () => (props.selected ? "stroke-accent-base" : "stroke-border-base")
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
      style={{ cursor: "grab" }}
    >
      <rect
        width={props.node.width}
        height={props.node.height}
        rx={8}
        ry={8}
        class={`${fill()} ${stroke()}`}
        stroke-width={props.selected ? 2 : 1}
      />
      {/* Input port (left edge, vertical midline). Hit-test friendly — slice 4 connects drag-to-here. */}
      <circle
        cx={0}
        cy={props.node.height / 2}
        r={PORT_RADIUS}
        class="fill-background-base stroke-border-base"
        stroke-width={1}
        data-automate-studio-port={`${props.node.id}:in`}
        aria-label={t("workbench.automate.canvas.portInput")}
      />
      {/* Output ports (right edge). A control.if node exposes two
          labelled branch ports (true / false); every other family
          exposes a single flow port. Pointer-down starts a connection. */}
      <For each={outputPortsFor(props.node.family)}>
        {(port) => (
          <circle
            cx={props.node.width}
            cy={props.node.height / 2 + port.dy}
            r={PORT_RADIUS}
            class="fill-accent-base"
            stroke-width={1}
            data-automate-studio-port={`${props.node.id}:out:${port.kind}`}
            aria-label={
              port.kind === "branch-true"
                ? t("workbench.automate.canvas.portTrue")
                : port.kind === "branch-false"
                  ? t("workbench.automate.canvas.portFalse")
                  : t("workbench.automate.canvas.portOutput")
            }
            style={{ cursor: "crosshair" }}
            onPointerDown={(event) => {
              event.stopPropagation()
              props.onOutputPortPointerDown(port.kind, event)
            }}
          />
        )}
      </For>
      <Show when={isBranchingFamily(props.node.family)}>
        <text x={props.node.width + 10} y={props.node.height / 2 - BRANCH_PORT_OFFSET + 3} class="fill-text-weak" font-size="9">
          {t("workbench.automate.canvas.edgeBranchTrue")}
        </text>
        <text x={props.node.width + 10} y={props.node.height / 2 + BRANCH_PORT_OFFSET + 3} class="fill-text-weak" font-size="9">
          {t("workbench.automate.canvas.edgeBranchFalse")}
        </text>
      </Show>
      <text
        x={12}
        y={22}
        class="fill-text-strong"
        font-size="12"
        font-weight={600}
      >
        {props.node.id}
      </text>
      <text
        x={12}
        y={42}
        class="fill-text-weak"
        font-size="11"
      >
        {props.node.label}
      </text>
      <Show when={props.node.requiresApproval}>
        <g transform={`translate(${props.node.width - 76} ${props.node.height - 22})`}>
          <rect width={64} height={16} rx={4} ry={4} class="fill-accent-weak stroke-accent-base" stroke-width={1} />
          <text x={32} y={11} text-anchor="middle" class="fill-text-strong" font-size="9" font-weight={600}>
            {t("workbench.automate.canvas.approvalTag")}
          </text>
        </g>
      </Show>
    </g>
  )
}

/**
 * Visual class per edge kind. Branch edges are colour-coded so the
 * true/false routing is readable at a glance; plain user edges keep
 * the accent colour, synthetic sequential edges stay muted.
 */
function edgeClass(endpoints: EdgeEndpoint): string {
  if (endpoints.kind === "branch-true") return "text-accent-base"
  if (endpoints.kind === "branch-false") return "text-text-weak"
  return endpoints.user ? "text-accent-base" : "text-border-base"
}

function clampZoom(value: number): number {
  if (value < MIN_ZOOM) return MIN_ZOOM
  if (value > MAX_ZOOM) return MAX_ZOOM
  return Number(value.toFixed(2))
}

/**
 * SVG path for an edge between two horizontal-aligned rectangles. The
 * outgoing point sits at the right edge of the source; the incoming
 * point at the left edge of the target. A cubic bezier with horizontal
 * control points gives a clean S-curve that scales with the gap.
 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}
