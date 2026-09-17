/* SPDX-License-Identifier: MIT */

import { createSignal, For, Show, type JSX } from "solid-js"
import type { DesignCommand } from "../model/commands"
import type { DesignCommentV1, DesignDocumentV1, DesignNodeId } from "../model/schema"
import type { DesignCommentTarget } from "./comments"

/**
 * Design comments panel (v51 parity, ADR-039 section 31): the composer
 * publishes exactly one `addComment` per gesture, and the rows drive
 * `setCommentResolved` / `deleteComment` — the document stays the single
 * source of truth, the panel is a pure view.
 */
export function DesignCommentsPanel(props: {
  document: DesignDocumentV1
  target: DesignCommentTarget | undefined
  highlighted: string | undefined
  onCommand: (command: DesignCommand) => void
  onSelect: (ids: readonly DesignNodeId[]) => void
  onClearTarget: () => void
  onClose: () => void
}): JSX.Element {
  const [note, setNote] = createSignal("")
  let panel: HTMLElement | undefined
  // Resolving or deleting re-renders the row, which destroys the clicked
  // button and drops focus to <body>: keyboard shortcuts would stop reaching
  // the tab. The panel takes focus back so the shortcuts keep working.
  const keepFocus = () => panel?.focus()
  const comments = () => props.document.comments ?? []
  const open = () => comments().filter((comment) => comment.status === "open")
  const resolved = () => comments().filter((comment) => comment.status === "resolved")
  const nodeLabel = (nodeId: DesignNodeId | null) =>
    nodeId === null ? "zone" : (props.document.nodes[nodeId]?.name ?? "zone")
  const label = (comment: DesignCommentV1) => nodeLabel(comment.nodeId)
  const index = (comment: DesignCommentV1) => comments().indexOf(comment) + 1

  const publish = () => {
    const target = props.target
    const text = note().trim()
    if (!target || text.length === 0) return
    props.onCommand({
      kind: "addComment",
      comment: {
        id: crypto.randomUUID(),
        nodeId: target.nodeId,
        x: target.x,
        y: target.y,
        note: text,
        status: "open",
        createdAt: new Date().toISOString(),
      },
    })
    setNote("")
    props.onClearTarget()
  }

  const row = (comment: DesignCommentV1) => (
    <li
      class="rounded border border-border-base p-2"
      classList={{ "bg-background-base": props.highlighted === comment.id, "opacity-60": comment.status === "resolved" }}
      data-design-comment-row={comment.id}
      data-design-comment-status={comment.status}
      onClick={() => {
        if (comment.nodeId) props.onSelect([comment.nodeId])
      }}
    >
      <div class="flex items-center gap-1 text-11-regular text-text-weak">
        <span data-design-comment-index>#{index(comment)}</span>
        <span class="truncate">{label(comment)}</span>
        <button
          type="button"
          class="ml-auto rounded px-1 py-0.5"
          data-design-comment-resolve
          onClick={(event) => {
            event.stopPropagation()
            props.onCommand({ kind: "setCommentResolved", id: comment.id, resolved: comment.status === "open" })
            keepFocus()
          }}
        >
          {comment.status === "open" ? "Résoudre" : "Rouvrir"}
        </button>
        <button
          type="button"
          class="rounded px-1 py-0.5 text-text-danger"
          data-design-comment-delete
          onClick={(event) => {
            event.stopPropagation()
            props.onCommand({ kind: "deleteComment", id: comment.id })
            keepFocus()
          }}
        >
          Suppr
        </button>
      </div>
      <p class="mt-1 text-12-regular">{comment.note}</p>
    </li>
  )

  return (
    <aside
      ref={panel}
      tabindex={-1}
      class="flex w-56 shrink-0 flex-col overflow-y-auto border-l border-border-base bg-background-stronger outline-none"
      data-design-comments-panel
    >
      <header class="flex items-center gap-2 border-b border-border-base p-2">
        <h2 class="text-12-medium">Commentaires ({comments().length})</h2>
        <button type="button" class="ml-auto rounded px-1 py-0.5 text-11-regular" data-design-comments-close onClick={props.onClose}>
          Fermer
        </button>
      </header>
      <div class="border-b border-border-base p-2">
        <p class="text-11-regular text-text-weak" data-design-comment-target={props.target ? (props.target.nodeId ?? "zone") : ""}>
          <Show when={props.target} fallback={<>Cliquez un élément ou une zone pour commenter.</>}>
            {(target) => <>Cible : {nodeLabel(target().nodeId)}</>}
          </Show>
        </p>
        <textarea
          class="mt-2 h-16 w-full resize-none rounded border border-border-base bg-background-base p-2 text-12-regular"
          placeholder="Votre commentaire…"
          data-design-comment-note
          value={note()}
          onInput={(event) => setNote(event.currentTarget.value)}
        />
        <button
          type="button"
          class="mt-1 rounded border border-border-base px-2 py-1 text-12-regular disabled:opacity-40"
          data-design-comment-publish
          disabled={!props.target || note().trim().length === 0}
          onClick={publish}
        >
          Publier
        </button>
      </div>
      <Show when={open().length > 0}>
        <section class="p-2">
          <h3 class="text-11-medium text-text-weak">Ouverts</h3>
          <ul class="mt-1 flex flex-col gap-1">
            <For each={open()}>{(comment) => row(comment)}</For>
          </ul>
        </section>
      </Show>
      <Show when={resolved().length > 0}>
        <section class="p-2">
          <h3 class="text-11-medium text-text-weak">Résolus</h3>
          <ul class="mt-1 flex flex-col gap-1">
            <For each={resolved()}>{(comment) => row(comment)}</For>
          </ul>
        </section>
      </Show>
    </aside>
  )
}
