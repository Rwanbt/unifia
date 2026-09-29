/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { MemoryGraphFilters } from "./memory-graph"
import { filterMemoryGraph, memoryGraphZoom, type MemoryGraphData } from "./memory-panel-model"

// The reference's .m69-graph-world is a 1200x800 pixel plane centred on the
// viewport, the open note at its middle. The model lays notes on a radius-30
// ring around (50, 50); 8.2 px per unit puts them 246px out, as the
// reference draws them. Framing tightens that spread on each axis (never
// below 2.4 px per unit) rather than zooming out, so nodes and labels keep the reference's
// sizes on a phone.
const WORLD_WIDTH = 1200
const WORLD_HEIGHT = 800
const WORLD_SPREAD = 8.2
const MIN_SPREAD = 2.4
// The reference's zoom buttons step by 10%.
const ZOOM_STEP = 0.1
// Room kept around the nodes, and for a label right of a node, when fitting.
const FIT_MARGIN = 28
const FIT_LABEL = 96
// The counts and zoom controls float over the canvas' bottom 49px.
const FIT_FOOTER = 49

type Pan = { readonly x: number; readonly y: number }

const clampZoom = (zoom: number) => Math.round(Math.max(memoryGraphZoom.min, Math.min(memoryGraphZoom.max, zoom)) * 100) / 100

/**
 * The reference's Graph view (#graphView, module m69): a head with the
 * title, a node search and the filters, then a full-bleed dotted viewport
 * with the graph at 100%, the counts bottom-left and the zoom bottom-right.
 * Drag pans, the wheel and the buttons zoom (55-180%), Fit frames the
 * nodes. The reference's Stale filter has no runtime source and is absent.
 */
export function MemoryKnowledgeGraph(props: {
  graph: MemoryGraphData
  selectedPath?: string
  filters: MemoryGraphFilters
  onOpen: (path: string) => void
}): JSX.Element {
  const t = useLanguage().t
  const [search, setSearch] = createSignal("")
  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal<Pan>({ x: 0, y: 0 })
  const [panning, setPanning] = createSignal(false)
  const [spread, setSpread] = createSignal<Pan>({ x: WORLD_SPREAD, y: WORLD_SPREAD })
  let viewport: HTMLDivElement | undefined
  let drag: { pointerId: number; x: number; y: number; start: Pan } | undefined

  const shown = createMemo(() => filterMemoryGraph(props.graph, search(), props.selectedPath))
  const point = (x: number, y: number) => ({ x: WORLD_WIDTH / 2 + (x - 50) * spread().x, y: WORLD_HEIGHT / 2 + (y - 50) * spread().y })
  const position = (id: string) => {
    const graph = shown()
    const tag = id.startsWith("tag:") ? graph.tags.find((item) => `tag:${item.tag}` === id) : undefined
    const node = tag ?? graph.nodes.find((item) => item.path === id)
    return node ? point(node.x, node.y) : undefined
  }

  /** Frames the nodes at 100%: the spread shrinks until they fit, room kept
   * for the label right of each node. */
  const fit = () => {
    const graph = shown()
    const items = [...graph.nodes, ...graph.tags]
    const rect = viewport?.getBoundingClientRect()
    if (!rect || items.length === 0) return
    const xs = items.map((item) => item.x - 50)
    const ys = items.map((item) => item.y - 50)
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const across = (room: number, span: number) => span > 0 ? room / span : WORLD_SPREAD
    const clamp = (value: number) => Math.max(MIN_SPREAD, Math.min(WORLD_SPREAD, value))
    const next = {
      x: clamp(across(rect.width - FIT_MARGIN * 2 - FIT_LABEL, right - left)),
      y: clamp(across(rect.height - FIT_MARGIN * 2 - FIT_FOOTER, bottom - top)),
    }
    setSpread(next)
    setZoom(1)
    setPan({ x: -((left + right) / 2) * next.x - FIT_LABEL / 2, y: -((top + bottom) / 2) * next.y - FIT_FOOTER / 2 })
  }

  // The reference opens at its full spread, which on a phone pushes the
  // linked notes off screen; the graph opens framed instead.
  createEffect(on(shown, () => requestAnimationFrame(fit)))

  const zoomBy = (step: number) => setZoom(clampZoom(zoom() + step))

  const onPointerDown = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest("[data-memory-graph-node]")) return
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: pan() }
    setPanning(true)
    viewport?.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    setPan({ x: drag.start.x + event.clientX - drag.x, y: drag.start.y + event.clientY - drag.y })
  }
  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    drag = undefined
    setPanning(false)
    viewport?.releasePointerCapture(event.pointerId)
  }

  return (
    <div data-memory-knowledge-graph>
      <div data-memory-graph-head>
        <span data-memory-graph-title>{t("workbench.memory.graph.title")}</span>
        <input data-memory-graph-search value={search()} placeholder={t("workbench.memory.graph.search")} aria-label={t("workbench.memory.graph.search")} onInput={(event) => setSearch(event.currentTarget.value)} />
        <button type="button" data-memory-graph-filter data-memory-graph-depth onClick={() => props.filters.onDepth(props.filters.depth >= 3 ? 1 : props.filters.depth + 1)}>{t("workbench.memory.graph.depth", { depth: props.filters.depth })}</button>
        <button type="button" data-memory-graph-filter data-memory-graph-tags aria-pressed={props.filters.tags} onClick={() => props.filters.onTags(!props.filters.tags)}>{t("workbench.memory.graph.tags")}{props.filters.tags ? " ✓" : ""}</button>
        <button type="button" data-memory-graph-filter data-memory-graph-orphans aria-pressed={props.filters.orphans} onClick={() => props.filters.onOrphans(!props.filters.orphans)}>{t("workbench.memory.graph.orphans")}{props.filters.orphans ? " ✓" : ""}</button>
        <button type="button" data-memory-graph-filter data-memory-graph-fit onClick={() => fit()}>{t("workbench.memory.graph.fit")}</button>
      </div>
      <div
        ref={viewport}
        data-memory-graph-canvas
        data-panning={panning() ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={(event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP) }}
        onDblClick={() => fit()}
      >
        <Show when={shown().nodes.length > 0} fallback={<p data-memory-graph-empty>Choose a note to inspect its graph.</p>}>
          <div data-memory-graph-world style={{ transform: `translate(${pan().x - WORLD_WIDTH / 2}px, ${pan().y - WORLD_HEIGHT / 2}px) scale(${zoom()})` }}>
            <svg width={WORLD_WIDTH} height={WORLD_HEIGHT} viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} role="img" aria-label={t("workbench.memory.graph.title")}>
              <For each={shown().edges}>{(edge) => (
                <Show when={position(edge.from) && position(edge.to)}>
                  <line data-memory-graph-edge={edge.kind} x1={position(edge.from)!.x} y1={position(edge.from)!.y} x2={position(edge.to)!.x} y2={position(edge.to)!.y} />
                </Show>
              )}</For>
              <For each={shown().tags}>{(tag) => {
                const at = () => point(tag.x, tag.y)
                return (
                  <g data-memory-graph-tag={tag.tag}>
                    <circle cx={at().x} cy={at().y} r="9" />
                    <text x={at().x + 14} y={at().y + 3}>#{tag.tag}</text>
                  </g>
                )
              }}</For>
              <For each={shown().nodes}>{(node) => {
                const at = () => point(node.x, node.y)
                const active = () => node.path === props.selectedPath
                return (
                  <g role="button" tabindex="0" aria-label={node.title} data-memory-graph-node={node.path} data-active={active() ? "" : undefined} onClick={() => props.onOpen(node.path)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") props.onOpen(node.path) }}>
                    <circle data-memory-graph-hit cx={at().x} cy={at().y} r="34" />
                    <circle cx={at().x} cy={at().y} r={active() ? 20 : 14} />
                    <text x={at().x + 25} y={at().y + 4}>{node.title}</text>
                  </g>
                )
              }}</For>
            </svg>
          </div>
        </Show>
        <div data-memory-graph-summary>{t("workbench.memory.graph.summary", { notes: shown().nodes.length, links: shown().edges.filter((edge) => edge.kind === "note").length })}</div>
        <div data-memory-graph-zoom>
          <button type="button" aria-label={t("workbench.memory.graph.zoomOut")} onClick={() => zoomBy(-ZOOM_STEP)}>−</button>
          <span>{Math.round(zoom() * 100)}%</span>
          <button type="button" aria-label={t("workbench.memory.graph.zoomIn")} onClick={() => zoomBy(ZOOM_STEP)}>+</button>
        </div>
      </div>
    </div>
  )
}
