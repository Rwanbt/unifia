/* SPDX-License-Identifier: MIT */

import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type { DesignCommand } from "../model/commands"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"
import type { DesignCommentTarget } from "./comments"
import { createKonvaCanvas, type KonvaCanvasHandle } from "./konva/canvas-adapter"
import type { DesignDraft, DesignTool } from "./tools"
import type { DesignViewport } from "./viewport"

/**
 * Solid wrapper around the imperative Konva adapter. The renderer is
 * loaded on mount (lazy import inside the adapter), synced from the
 * reactive document/selection/tool props, and emits canonical commands or
 * creation drafts only.
 */
export function DesignCanvas(props: {
  document: DesignDocumentV1
  selection: readonly DesignNodeId[]
  tool: DesignTool
  onSelect: (ids: readonly DesignNodeId[]) => void
  onCommand: (command: DesignCommand) => void
  onCreate: (draft: DesignDraft) => void
  onCommentTarget?: (target: DesignCommentTarget) => void
  onCommentFocus?: (id: string) => void
}): JSX.Element {
  let container!: HTMLDivElement
  let handle: KonvaCanvasHandle | undefined
  let disposed = false
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading")
  const [viewport, setViewport] = createSignal<DesignViewport>({ panX: 0, panY: 0, zoom: 1 })

  const push = () => {
    handle?.sync(props.document, props.selection, viewport(), props.tool)
  }

  onMount(() => {
    void createKonvaCanvas({
      container,
      onSelect: props.onSelect,
      onCommand: props.onCommand,
      onViewport: setViewport,
      onCreate: props.onCreate,
      onCommentTarget: props.onCommentTarget,
      onCommentFocus: props.onCommentFocus,
    })
      .then((created) => {
        if (disposed) {
          created.destroy()
          return
        }
        handle = created
        push()
        setStatus("ready")
      })
      .catch(() => setStatus("error"))
  })

  createEffect(() => {
    // Tracks the document, the selection, the tool and the viewport, then re-syncs.
    void props.document
    void props.selection
    void props.tool
    void viewport()
    push()
  })

  onCleanup(() => {
    disposed = true
    handle?.destroy()
    handle = undefined
  })

  return (
    <div
      ref={container}
      class="relative size-full overflow-hidden bg-background-base outline-none"
      tabindex={0}
      data-design-canvas
      data-design-canvas-status={status()}
    />
  )
}
