/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Studio minimap — the bottom-right overview rectangle that
 * shows where the current viewport sits inside the full graph.
 *
 * Phase 8 slice 9: read-only overview. The minimap renders each
 * laid-out node as a small accent-coloured rectangle (extra
 * nodes get a different colour so the user can distinguish
 * library-added nodes from legacy steps at a glance) and
 * overlays a translucent viewport rectangle showing what's
 * currently visible in the canvas.
 *
 * The viewport indicator is computed from the parent-supplied
 * `viewport` (pan + zoom) plus the canvas pane size. The minimap
 * itself does not own pan/zoom state — it reads from the same
 * controlled shape used by the canvas. Click on the minimap
 * fires `onJumpTo(panX, panY, zoom)` so a future slice can wire
 * a "click to recentre" interaction; for now the callback is
 * optional and the minimap is a passive overview.
 */
import { For, Show, createMemo, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { LaidOutGraph, NodePositionOverride } from "./automate-graph-layout"

export type MinimapViewport = {
  /** Pan offset in CSS pixels (canvas world). */
  readonly panX: number
  /** Pan offset in CSS pixels. */
  readonly panY: number
  /** Current zoom factor. */
  readonly zoom: number
}

export type AutomateStudioMinimapProps = {
  readonly graph: LaidOutGraph
  /** CSS width of the canvas pane — drives the viewport rectangle. */
  readonly viewportWidth: number
  /** CSS height of the canvas pane. */
  readonly viewportHeight: number
  /** Current canvas viewport. */
  readonly viewport: MinimapViewport
  /** Position overrides so the minimap reflects user drags. */
  readonly positions: Readonly<Record<string, NodePositionOverride>>
  /** Optional click callback for "jump to here" (slice 9.5 follow-up). */
  readonly onJumpTo?: (panX: number, panY: number, zoom: number) => void
}

const MINIMAP_PADDING = 4

export function AutomateStudioMinimap(props: AutomateStudioMinimapProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const width = (): number => Math.max(props.viewportWidth, 1)
  const height = (): number => Math.max(props.viewportHeight, 1)
  /**
   * Compute the scale that fits the entire graph into the
   * minimap's own viewport. Independent of the canvas zoom —
   * the minimap always shows the whole graph.
   */
  const scale = createMemo<number>(() => {
    const innerW = width() - MINIMAP_PADDING * 2
    const innerH = height() - MINIMAP_PADDING * 2
    if (props.graph.width === 0 || props.graph.height === 0) return 1
    return Math.min(innerW / props.graph.width, innerH / props.graph.height)
  })
  const offsetX = (): number => (width() - props.graph.width * scale()) / 2
  const offsetY = (): number => (height() - props.graph.height * scale()) / 2
  /**
   * Canvas viewport rectangle expressed in graph coords. The
   * inner `<g>` applies pan + zoom, so the visible area in
   * graph coords is the inverse of the canvas transform:
   * visibleGraphX = (cssX - panX) / zoom.
   */
  const viewportRect = createMemo(() => {
    const z = props.viewport.zoom || 1
    const visibleGraphX = -props.viewport.panX / z
    const visibleGraphY = -props.viewport.panY / z
    const visibleGraphW = width() / z
    const visibleGraphH = height() / z
    return {
      x: offsetX() + visibleGraphX * scale(),
      y: offsetY() + visibleGraphY * scale(),
      width: visibleGraphW * scale(),
      height: visibleGraphH * scale(),
    }
  })
  return (
    <div
      class="relative h-full w-full overflow-hidden rounded border border-border-base bg-background-base"
      data-automate-studio-minimap
      onClick={(event) => {
        if (!props.onJumpTo) return
        // Translate the click into graph coords using the same
        // scale + offset the minimap uses to render, then call
        // back with the inverse canvas transform that centres
        // the click.
        const target = event.currentTarget as HTMLElement
        const rect = target.getBoundingClientRect()
        const cssX = event.clientX - rect.left
        const cssY = event.clientY - rect.top
        const graphX = (cssX - offsetX()) / scale()
        const graphY = (cssY - offsetY()) / scale()
        const z = props.viewport.zoom || 1
        props.onJumpTo(width() / 2 - graphX * z, height() / 2 - graphY * z, z)
      }}
    >
      <svg
        class="block size-full"
        viewBox={`0 0 ${width()} ${height()}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label={t("workbench.automate.minimap.label")}
      >
        <rect
          x={0}
          y={0}
          width={width()}
          height={height()}
          fill="transparent"
          data-automate-studio-minimap-background
        />
        <For each={props.graph.nodes}>
          {(node) => {
            const isExtra = (): boolean => props.positions[node.id] !== undefined
            const x = (): number => {
              const override = props.positions[node.id]
              return offsetX() + (override?.x ?? node.x) * scale()
            }
            const y = (): number => {
              const override = props.positions[node.id]
              return offsetY() + (override?.y ?? node.y) * scale()
            }
            return (
              <rect
                x={x()}
                y={y()}
                width={Math.max(node.width * scale(), 2)}
                height={Math.max(node.height * scale(), 2)}
                rx={1.5}
                fill={isExtra() ? "currentColor" : "var(--color-border-base, #d4d4d8)"}
                class={isExtra() ? "text-accent-base" : "fill-border-base"}
                data-automate-studio-minimap-node={node.id}
                data-automate-studio-minimap-node-extra={isExtra() ? "true" : "false"}
              />
            )
          }}
        </For>
        <Show when={props.graph.nodes.length > 0}>
          <rect
            x={viewportRect().x}
            y={viewportRect().y}
            width={viewportRect().width}
            height={viewportRect().height}
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="text-accent-base pointer-events-none"
            data-automate-studio-minimap-viewport
          />
        </Show>
      </svg>
    </div>
  )
}
