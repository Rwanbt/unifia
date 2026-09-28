/* SPDX-License-Identifier: MIT */

import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { DesignCommand } from "../model/commands"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"
import { buildLayerRows, resolveLayerDrop, type DesignLayerRow } from "./layer-rows"
import { StudioIcon } from "./studio-icons"

/** Reference glyph per node type (`.v51-layer-glyph`); containers show the fold chevron. */
const GLYPHS: Record<DesignLayerRow["type"], string> = {
  frame: "⌄",
  group: "⌄",
  rectangle: "▭",
  ellipse: "○",
  line: "╱",
  path: "∿",
  text: "T",
  image: "▣",
}

/** Indent of one tree level, measured on the reference rows (glyph x 110 → 120 → 130). */
const DEPTH_INDENT_PX = 10

/**
 * Layers panel for the native canvas: a pure view over the canonical
 * hierarchy. Visibility, lock, rename, reorder and reparent all become typed
 * commands; the panel owns no ordering model of its own (ADR-039 section 10).
 * Markup and metrics follow the reference's `.v51-layer-*` rows (ADR-085).
 */
export function DesignLayersPanel(props: {
  document: DesignDocumentV1
  selection: readonly DesignNodeId[]
  onSelect: (id: DesignNodeId) => void
  onCommand: (command: DesignCommand) => void
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  let dragged: DesignNodeId | undefined
  const [query, setQuery] = createSignal("")
  const [renaming, setRenaming] = createSignal<DesignNodeId>()
  const rows = createMemo(() => {
    const term = query().trim().toLocaleLowerCase()
    const all = buildLayerRows(props.document)
    return term ? all.filter((row) => row.name.toLocaleLowerCase().includes(term)) : all
  })

  const drop = (targetId: DesignNodeId) => {
    const source = dragged
    dragged = undefined
    if (!source) return
    const command = resolveLayerDrop(props.document, source, targetId)
    if (command) props.onCommand(command)
  }

  const commitRename = (row: DesignLayerRow, value: string) => {
    setRenaming(undefined)
    const name = value.trim()
    if (name && name !== row.name) props.onCommand({ kind: "updateNode", id: row.id, name })
  }

  return (
    <div data-design-layers>
      <label data-design-layer-search>
        <StudioIcon name="search" />
        <input
          type="search"
          value={query()}
          placeholder={t("design.studio.layers.search")}
          aria-label={t("design.studio.layers.search")}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div data-design-layer-tree>
        <For each={rows()}>
          {(row) => (
            <div
              data-design-layer-row={row.id}
              data-selected={props.selection.includes(row.id) ? "" : undefined}
              data-hidden={row.visible ? undefined : ""}
              data-locked={row.locked ? "" : undefined}
              style={{ "padding-left": `${5 + row.depth * DEPTH_INDENT_PX}px` }}
              draggable={renaming() !== row.id}
              onDragStart={(event) => {
                dragged = row.id
                event.dataTransfer?.setData("text/plain", row.id)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                drop(row.id)
              }}
              onClick={() => props.onSelect(row.id)}
            >
              <span data-design-layer-glyph>{GLYPHS[row.type]}</span>
              <Show
                when={renaming() === row.id}
                fallback={<span data-design-layer-name>{row.name}</span>}
              >
                <input
                  data-design-layer-rename-input
                  value={row.name}
                  aria-label={t("design.studio.layers.rename", { name: row.name })}
                  ref={(element) => queueMicrotask(() => element.select())}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === "Enter") commitRename(row, event.currentTarget.value)
                    if (event.key === "Escape") setRenaming(undefined)
                  }}
                  onBlur={(event) => {
                    if (renaming() === row.id) commitRename(row, event.currentTarget.value)
                  }}
                />
              </Show>
              <span data-design-layer-actions>
                <button
                  type="button"
                  title={t("design.studio.layers.renameTitle")}
                  aria-label={t("design.studio.layers.rename", { name: row.name })}
                  data-design-layer-rename={row.id}
                  onClick={(event) => {
                    event.stopPropagation()
                    setRenaming(row.id)
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  title={t("design.studio.layers.visibilityTitle")}
                  aria-label={t(row.visible ? "design.studio.layers.hide" : "design.studio.layers.show", { name: row.name })}
                  aria-pressed={!row.visible}
                  data-design-layer-visibility={row.id}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onCommand({ kind: "setVisibility", id: row.id, visible: !row.visible })
                  }}
                >
                  {row.visible ? "◉" : "◌"}
                </button>
                <button
                  type="button"
                  title={t("design.studio.layers.lockTitle")}
                  aria-label={t(row.locked ? "design.studio.layers.unlock" : "design.studio.layers.lock", { name: row.name })}
                  aria-pressed={row.locked}
                  data-design-layer-lock={row.id}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onCommand({ kind: "setLocked", id: row.id, locked: !row.locked })
                  }}
                >
                  {row.locked ? "●" : "○"}
                </button>
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
