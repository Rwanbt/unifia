/* SPDX-License-Identifier: MIT */

import { createMemo, For, type JSX } from "solid-js"
import type { DesignCommand } from "../model/commands"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"
import { buildLayerRows, resolveLayerDrop } from "./layer-rows"

/**
 * Layers panel for the native canvas: a pure view over the canonical
 * hierarchy. Visibility, lock, reorder and reparent all become typed
 * commands; the panel owns no ordering model of its own (ADR-039 section 10).
 */
export function DesignLayersPanel(props: {
  document: DesignDocumentV1
  selection: readonly DesignNodeId[]
  onSelect: (id: DesignNodeId) => void
  onCommand: (command: DesignCommand) => void
}): JSX.Element {
  let dragged: DesignNodeId | undefined
  const rows = createMemo(() => buildLayerRows(props.document))

  const drop = (targetId: DesignNodeId) => {
    const source = dragged
    dragged = undefined
    if (!source) return
    const command = resolveLayerDrop(props.document, source, targetId)
    if (command) props.onCommand(command)
  }

  return (
    <div class="flex w-52 shrink-0 flex-col border-r border-border-base" data-design-layers>
      <div class="border-b border-border-base px-2 py-1 text-12-regular text-text-weak">Layers</div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <For each={rows()}>
          {(row) => (
            <div
              class="flex items-center gap-1 px-2 py-1 text-12-regular"
              classList={{ "bg-background-stronger": props.selection.includes(row.id) }}
              style={{ "padding-left": `${row.depth * 12 + 8}px` }}
              draggable="true"
              data-design-layer-row={row.id}
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
              <button
                type="button"
                class="w-4 text-center"
                title={row.visible ? "Hide" : "Show"}
                aria-label={row.visible ? "Hide layer" : "Show layer"}
                data-design-layer-visibility={row.id}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onCommand({ kind: "setVisibility", id: row.id, visible: !row.visible })
                }}
              >
                {row.visible ? "◉" : "◯"}
              </button>
              <button
                type="button"
                class="w-4 text-center"
                title={row.locked ? "Unlock" : "Lock"}
                aria-label={row.locked ? "Unlock layer" : "Lock layer"}
                data-design-layer-lock={row.id}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onCommand({ kind: "setLocked", id: row.id, locked: !row.locked })
                }}
              >
                {row.locked ? "◆" : "◇"}
              </button>
              <span class="truncate">{row.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
