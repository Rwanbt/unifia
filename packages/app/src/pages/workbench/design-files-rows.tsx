/* SPDX-License-Identifier: MIT */

// Row components of the Design "Files" tab, split out of design-files-tab.tsx
// (ADR-099): pure presentation, no queries or mutations.

import { For, Show, type JSX } from "solid-js"
import { FileIcon } from "@unifia/ui/file-icon"
import { FileThumbnail, type ThumbnailController } from "@/pages/workbench/design-files-thumbnail"
import type { DesignFileRow, DesignFileTreeNode, DesignFilesTreeExpansion } from "@unifia/workbench-shell"
export function FileRow(props: { row: DesignFileRow; onSelect: (path: string) => void; thumbnails: ThumbnailController }): JSX.Element {
  return (
    <li>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-12-regular hover:bg-background-stronger"
        classList={{ "bg-background-stronger text-text-strong": props.row.selected }}
        data-design-files-row={props.row.path}
        aria-current={props.row.selected ? "true" : undefined}
        onClick={() => props.onSelect(props.row.path)}
        title={props.row.path}
      >
        <FileIcon node={{ path: props.row.path, type: "file" }} class="size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{props.row.label}</span>
      </button>
      <FileThumbnail path={props.row.path} controller={props.thumbnails} />
    </li>
  )
}

/**
 * A tree row's indentation grows with depth; 14px roughly matches one
 * `size-4` icon width plus its gap, so a child's icon lines up under its
 * parent's label rather than under its parent's icon.
 */
const TREE_INDENT_PX = 14
const TREE_BASE_PADDING_PX = 8

export function TreeRow(props: {
  node: DesignFileTreeNode
  depth: number
  expanded: DesignFilesTreeExpansion
  selectedPath?: string
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  thumbnails: ThumbnailController
}): JSX.Element {
  const paddingLeft = `${TREE_BASE_PADDING_PX + props.depth * TREE_INDENT_PX}px`

  return (
    <Show
      when={props.node.type === "directory" ? props.node : undefined}
      fallback={
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-12-regular hover:bg-background-stronger"
            classList={{ "bg-background-stronger text-text-strong": props.node.path === props.selectedPath }}
            style={{ "padding-left": paddingLeft }}
            data-design-files-row={props.node.path}
            aria-current={props.node.path === props.selectedPath ? "true" : undefined}
            onClick={() => props.onSelect(props.node.path)}
            title={props.node.path}
          >
            <FileIcon node={{ path: props.node.path, type: "file" }} class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
          </button>
          <FileThumbnail path={props.node.path} controller={props.thumbnails} />
        </li>
      }
    >
      {(directory) => (
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-12-regular hover:bg-background-stronger"
            style={{ "padding-left": paddingLeft }}
            data-design-files-dir={directory().path}
            aria-expanded={props.expanded.has(directory().path)}
            onClick={() => props.onToggle(directory().path)}
            title={directory().path}
          >
            <span class="flex size-4 shrink-0 items-center justify-center text-text-weak" aria-hidden="true">
              {props.expanded.has(directory().path) ? "▾" : "▸"}
            </span>
            <span class="min-w-0 flex-1 truncate">{directory().name}</span>
          </button>
          <Show when={props.expanded.has(directory().path)}>
            <ul class="flex flex-col gap-0.5">
              <For each={directory().children}>
                {(child) => (
                  <TreeRow
                    node={child}
                    depth={props.depth + 1}
                    expanded={props.expanded}
                    selectedPath={props.selectedPath}
                    onToggle={props.onToggle}
                    onSelect={props.onSelect}
                    thumbnails={props.thumbnails}
                  />
                )}
              </For>
            </ul>
          </Show>
        </li>
      )}
    </Show>
  )
}
