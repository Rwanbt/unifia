/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { DesignTool } from "./tools"

/**
 * Canvas chrome of the Design studio (ADR-085): the floating tool dock of the
 * reference (`.v55-design-toolbar`), its change bar (`.v51-changebar`), zoom
 * pill (`.canvas-zoom-toolbar`) and "Présenter" button. Pure view: the
 * canvas tab owns every state and command.
 */

type DockEntry =
  | { kind: "tool"; tool: DesignTool; glyph: string; label?: string; key: string }
  | { kind: "pending"; id: string; glyph: string; label?: string; key: string }
  | { kind: "sep" }

/** Reference order: Select, Node | Pen, Pencil, Line, Rectangle, Ellipse | Snap. */
const DOCK: readonly DockEntry[] = [
  { kind: "tool", tool: "select", glyph: "V", label: "select", key: "V" },
  { kind: "pending", id: "node", glyph: "A", label: "node", key: "N" },
  { kind: "sep" },
  { kind: "tool", tool: "pen", glyph: "P", label: "pen", key: "P" },
  { kind: "pending", id: "pencil", glyph: "✎", key: "B" },
  { kind: "tool", tool: "line", glyph: "╱", key: "L" },
  { kind: "tool", tool: "rectangle", glyph: "□", key: "R" },
  { kind: "tool", tool: "ellipse", glyph: "○", key: "O" },
  { kind: "sep" },
]

/** Single-key shortcuts shown in the dock titles. */
export const DESIGN_TOOL_KEYS: Readonly<Record<string, DesignTool>> = {
  v: "select",
  p: "pen",
  l: "line",
  r: "rectangle",
  o: "ellipse",
}

export function DesignStudioDock(props: {
  tool: DesignTool
  onTool: (tool: DesignTool) => void
  narrow: boolean
  importSlot?: JSX.Element
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const name = (id: string) => t(`design.studio.tool.${id}`)
  return (
    <div data-design-studio-dock role="toolbar" aria-label={t("design.studio.dock")}>
      <For each={DOCK}>
        {(entry) => {
          if (entry.kind === "sep") return <span data-design-studio-sep />
          const id = entry.kind === "tool" ? entry.tool : entry.id
          const title = `${name(id)} · ${entry.key}`
          return (
            <button
              type="button"
              data-design-tool={entry.kind === "tool" ? entry.tool : undefined}
              data-design-studio-pending={entry.kind === "pending" ? entry.id : undefined}
              aria-pressed={entry.kind === "tool" ? props.tool === entry.tool : undefined}
              aria-disabled={entry.kind === "pending" ? "true" : undefined}
              title={entry.kind === "pending" ? t("design.studio.soon", { label: title }) : title}
              aria-label={entry.kind === "pending" ? t("design.studio.soon", { label: title }) : title}
              onClick={() => {
                if (entry.kind === "tool") props.onTool(entry.tool)
              }}
            >
              {entry.glyph}
              <Show when={entry.label && !props.narrow}>
                <span data-design-studio-label-text>{t(`design.studio.toolLabel.${entry.label}`)}</span>
              </Show>
            </button>
          )
        }}
      </For>
      <button
        type="button"
        data-design-studio-snap
        aria-pressed="true"
        aria-disabled="true"
        title={t("design.studio.snap")}
        aria-label={t("design.studio.snap")}
      >
        <span>
          <i />
          {t("design.studio.snapLabel")}
        </span>
      </button>
      {props.importSlot}
    </div>
  )
}

export type DesignSaveState = "saved" | "saving"

export function DesignStudioChangeBar(props: {
  saveState: DesignSaveState
  canUndo: boolean
  canRedo: boolean
  canRevert: boolean
  onUndo: () => void
  onRedo: () => void
  onRevert: () => void
  onCheckpoint: () => void
  compact: boolean
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <div data-design-studio-changebar>
      <Show when={!props.compact}>
        <span data-design-studio-save-state={props.saveState}>
          {t(props.saveState === "saved" ? "design.studio.saved" : "design.studio.saving")}
        </span>
      </Show>
      <button
        type="button"
        data-design-canvas-undo
        disabled={!props.canUndo}
        title={t("design.studio.undoTitle")}
        aria-label={t("design.studio.undo")}
        onClick={() => props.onUndo()}
      >
        ↶
      </button>
      <button
        type="button"
        data-design-canvas-redo
        disabled={!props.canRedo}
        title={t("design.studio.redoTitle")}
        aria-label={t("design.studio.redo")}
        onClick={() => props.onRedo()}
      >
        ↷
      </button>
      <button
        type="button"
        data-design-studio-revert
        disabled={!props.canRevert}
        title={t("design.studio.revertTitle")}
        aria-label={t("design.studio.revertTitle")}
        onClick={() => props.onRevert()}
      >
        {props.compact ? "↺" : t("design.studio.revert")}
      </button>
      <button
        type="button"
        data-design-studio-checkpoint
        disabled={!props.canRevert}
        title={t("design.studio.checkpointTitle")}
        aria-label={t("design.studio.checkpointTitle")}
        onClick={() => props.onCheckpoint()}
      >
        {props.compact ? "✓" : t("design.studio.checkpoint")}
      </button>
    </div>
  )
}

export function DesignStudioZoom(props: {
  zoom: number
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <div data-design-studio-zoom>
      <button type="button" title={t("design.studio.zoomOut")} aria-label={t("design.studio.zoomOut")} onClick={() => props.onZoomOut()}>
        −
      </button>
      <button
        type="button"
        data-design-studio-zoom-level
        title={t("design.studio.zoomReset")}
        aria-label={t("design.studio.zoomReset")}
        onClick={() => props.onReset()}
      >
        {Math.round(props.zoom * 100)}%
      </button>
      <button type="button" title={t("design.studio.zoomIn")} aria-label={t("design.studio.zoomIn")} onClick={() => props.onZoomIn()}>
        +
      </button>
    </div>
  )
}
