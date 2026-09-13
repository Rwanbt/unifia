/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio canvas — the read-only center pane of the Automate surface.
 *
 * Phase 8 first slice: render the selected workflow's steps as a
 * left-to-right node graph with pan/zoom and a deterministic layout.
 * Editing (drag-to-move, port connections) lives in a follow-up slice.
 *
 * Interactions:
 * - Pan: left-button drag on the background, or hold Space + drag.
 * - Zoom: Ctrl/Cmd + mouse wheel (range 0.5 - 2.0).
 * - Reset: double-click on the background.
 * - Selection: click on a node sets the `selectedNodeId` signal (parent
 *   can pass it through to the right-side inspector in a follow-up
 *   slice; for now the selection is local to the canvas so the
 *   component remains a pure view).
 *
 * Accessibility: the canvas exposes a single `role="img"` element with
 * an `aria-label` summarising the workflow (id, step count, approval
 * count) and a parallel hidden `<ol>` listing every step so screen
 * readers don't have to descend into the SVG subtree. Keyboard users
 * can Tab through the reset/zoom buttons instead of navigating pixels.
 */
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { layoutWorkflowSteps, type LaidOutGraph, type LaidOutNode } from "./automate-graph-layout"
import type { WorkflowStepSummary } from "./automate-workflow-model"

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
}

export function AutomateStudioCanvas(props: AutomateStudioCanvasProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const graph = createMemo<LaidOutGraph>(() => layoutWorkflowSteps(props.steps))
  const [panX, setPanX] = createSignal(0)
  const [panY, setPanY] = createSignal(0)
  const [zoom, setZoom] = createSignal(1)
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  const [dragging, setDragging] = createSignal<{ x: number; y: number } | undefined>()
  const selectedNodeId = (): string | undefined => props.selectedNodeId
  const selectNode = (id: string | undefined): void => props.onSelectNode?.(id)

  function onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    const next = clampZoom(zoom() + direction)
    setZoom(next)
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    if (!spaceHeld() && !(event.target as Element).hasAttribute?.("data-canvas-background")) return
    setDragging({ x: event.clientX, y: event.clientY })
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: PointerEvent): void {
    const drag = dragging()
    if (!drag) return
    setPanX(panX() + (event.clientX - drag.x))
    setPanY(panY() + (event.clientY - drag.y))
    setDragging({ x: event.clientX, y: event.clientY })
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging()) return
    ;(event.currentTarget as Element).releasePointerCapture?.(event.pointerId)
    setDragging(undefined)
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
          aria-label={t("workbench.automate.canvas.resetView")}
          onClick={onReset}
        >
          {t("workbench.automate.canvas.reset")}
        </button>
      </div>
      <svg
        role="img"
        aria-label={t("workbench.automate.canvas.workflowLabel", { summary: summary() })}
        class="block size-full select-none"
        viewBox={`0 0 ${Math.max(props.width, 1)} ${Math.max(props.height, 1)}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
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
          <Show when={graph().edges.length > 0}>
            <g data-automate-studio-edges>
              <For each={graph().edges}>
                {(edge) => (
                  <path
                    d={edgePath(edge.x1, edge.y1, edge.x2, edge.y2)}
                    stroke="currentColor"
                    stroke-width="1.5"
                    fill="none"
                    class="text-border-base"
                    data-automate-studio-edge={`${edge.from}->${edge.to}`}
                    marker-end="url(#automate-arrowhead)"
                  />
                )}
              </For>
            </g>
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
                selected={selectedNodeId() === node.id}
                onSelect={() => selectNode(node.id)}
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
  readonly selected: boolean
  readonly onSelect: () => void
}

function NodeRect(props: NodeRectProps): JSX.Element {
  const t = useLanguage().t
  const fill = () => (props.selected ? "fill-background-base" : "fill-background-stronger")
  const stroke = () => (props.selected ? "stroke-accent-base" : "stroke-border-base")
  return (
    <g
      transform={`translate(${props.node.x} ${props.node.y})`}
      data-automate-studio-node={props.node.id}
      data-automate-studio-node-selected={props.selected ? "true" : "false"}
      data-automate-studio-node-approval={props.node.requiresApproval ? "true" : "false"}
      onClick={(event) => {
        event.stopPropagation()
        props.onSelect()
      }}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={props.node.width}
        height={props.node.height}
        rx={8}
        ry={8}
        class={`${fill()} ${stroke()}`}
        stroke-width={props.selected ? 2 : 1}
      />
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
