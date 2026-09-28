/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { memoryGraphFit, memoryGraphZoom, type MemoryGraphData, type MemoryGraphView } from "./memory-panel-model"

// Margin kept around the graph content by the fit gesture, in graph units.
const MEMORY_GRAPH_PAD = 6

export type MemoryGraphFilters = {
  readonly depth: number
  readonly tags: boolean
  readonly orphans: boolean
  readonly onDepth: (depth: number) => void
  readonly onTags: (tags: boolean) => void
  readonly onOrphans: (orphans: boolean) => void
}

/**
 * The depth-N note graph with its filters (module m69). Each instance owns
 * its viewport: drag pans, the wheel zooms (clamped 0.55-1.8) and a
 * double-click fits the content. The layout normalises nodes around
 * (50, 50), so the identity view is the fallback when a fit is impossible.
 * The links pane's "Local graph" tab and the phone's Graph view both render
 * it (ADR-059).
 */
export function MemoryGraph(props: {
  graph: MemoryGraphData
  selectedPath?: string
  filters: MemoryGraphFilters
  onOpen: (path: string) => void
}): JSX.Element {
  const t = useLanguage().t
  const [view, setView] = createSignal<MemoryGraphView>({ x: 0, y: 0, zoom: 1 })
  const [panning, setPanning] = createSignal(false)
  let svg: SVGSVGElement | undefined
  let content: SVGGElement | undefined
  let pan: { pointerId: number; from: { x: number; y: number }; start: MemoryGraphView } | undefined

  const point = (clientX: number, clientY: number) => {
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return undefined
    const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return { x: local.x, y: local.y }
  }

  const fit = () => {
    if (!svg || !content) return
    const rect = svg.getBoundingClientRect()
    // The square viewBox uses `meet`, so one user unit is the smaller side.
    const scale = Math.min(rect.width, rect.height) / 100
    if (!Number.isFinite(scale) || scale <= 0) return
    // getBBox includes the element's own transform, so the bounds are read
    // from the untransformed content group: the fit stays idempotent across
    // pan and zoom.
    let box: { x: number; y: number; width: number; height: number }
    try {
      box = content.getBBox()
    } catch {
      return
    }
    const viewport = { width: rect.width / scale, height: rect.height / scale }
    setView(memoryGraphFit(box, viewport, { x: 50, y: 50 }, MEMORY_GRAPH_PAD) ?? { x: 0, y: 0, zoom: 1 })
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const cursor = point(event.clientX, event.clientY)
    if (!cursor) return
    const current = view()
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    const zoom = Math.max(memoryGraphZoom.min, Math.min(memoryGraphZoom.max, current.zoom * factor))
    if (zoom === current.zoom) return
    setView({
      zoom,
      x: cursor.x - ((cursor.x - current.x) / current.zoom) * zoom,
      y: cursor.y - ((cursor.y - current.y) / current.zoom) * zoom,
    })
  }

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Element | null
    if (target?.closest("[data-memory-graph-node], [data-memory-graph-tag], button, input")) return
    const from = point(event.clientX, event.clientY)
    if (!from) return
    pan = { pointerId: event.pointerId, from, start: view() }
    setPanning(true)
    svg?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent) => {
    const current = pan
    if (!current || current.pointerId !== event.pointerId) return
    const to = point(event.clientX, event.clientY)
    if (!to) return
    setView({ zoom: current.start.zoom, x: current.start.x + (to.x - current.from.x), y: current.start.y + (to.y - current.from.y) })
  }

  const endPan = (event: PointerEvent) => {
    const current = pan
    if (!current || current.pointerId !== event.pointerId) return
    pan = undefined
    setPanning(false)
    svg?.releasePointerCapture(event.pointerId)
  }

  createEffect(() => {
    // Refit when the content changes; the fit is deterministic, so new
    // content simply replaces pan and zoom.
    void props.graph
    requestAnimationFrame(fit)
  })

  const find = (path: string) => props.graph.nodes.find((node) => node.path === path)

  return (
    <Show when={props.graph.nodes.length > 0} fallback={<p>Choose a note to inspect its graph.</p>}>
      <div data-memory-graph-controls>
        <button type="button" data-memory-graph-depth onClick={() => props.filters.onDepth(props.filters.depth >= 3 ? 1 : props.filters.depth + 1)}>{t("workbench.memory.graph.depth", { depth: props.filters.depth })}</button>
        <button type="button" data-memory-graph-tags aria-pressed={props.filters.tags} onClick={() => props.filters.onTags(!props.filters.tags)}>{t("workbench.memory.graph.tags")}</button>
        <button type="button" data-memory-graph-orphans aria-pressed={props.filters.orphans} onClick={() => props.filters.onOrphans(!props.filters.orphans)}>{t("workbench.memory.graph.orphans")}</button>
      </div>
      <svg ref={svg} data-memory-graph-viewport data-panning={panning() ? "" : undefined} viewBox="0 0 100 100" role="img" aria-label="Local memory graph" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPan} onPointerCancel={endPan} onDblClick={() => fit()}>
        <g data-memory-graph-world transform={`translate(${view().x} ${view().y}) scale(${view().zoom})`}>
          <g ref={content}>
            <For each={props.graph.edges}>{(edge) => {
              const from = () => edge.kind === "tag" ? props.graph.tags.find((tag) => `tag:${tag.tag}` === edge.from) : find(edge.from)
              const to = () => find(edge.to)
              return <Show when={from() && to()}>
                <line x1={from()!.x} y1={from()!.y} x2={to()!.x} y2={to()!.y} stroke="currentColor" opacity={edge.kind === "tag" ? "0.2" : "0.35"} stroke-dasharray={edge.kind === "tag" ? "2 2" : undefined} />
              </Show>
            }}</For>
            <For each={props.graph.tags}>{(tag) => (
              <g data-memory-graph-tag={tag.tag}>
                <circle cx={tag.x} cy={tag.y} r="4" />
                <text x={tag.x} y={tag.y + 8} text-anchor="middle">#{tag.tag.slice(0, 12)}</text>
              </g>
            )}</For>
            <For each={props.graph.nodes}>{(node) => (
              <g role="button" tabindex="0" data-memory-graph-node={node.path} onClick={() => props.onOpen(node.path)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") props.onOpen(node.path) }}>
                <circle cx={node.x} cy={node.y} r={node.path === props.selectedPath ? 8 : 6} data-active={node.path === props.selectedPath ? "" : undefined} />
                <text x={node.x} y={node.y + 13} text-anchor="middle">{node.title.slice(0, 16)}</text>
              </g>
            )}</For>
          </g>
        </g>
      </svg>
      <p data-memory-graph-summary>{t("workbench.memory.graph.summary", { notes: props.graph.nodes.length, links: props.graph.edges.filter((edge) => edge.kind === "note").length })}</p>
    </Show>
  )
}
