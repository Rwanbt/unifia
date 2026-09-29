/* SPDX-License-Identifier: MIT */

import { createSignal, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
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
  const language = useLanguage()
  const t = language.t
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
    nodeId === null ? t("design.studio.comments.zone") : (props.document.nodes[nodeId]?.name ?? t("design.studio.comments.zone"))
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
      data-design-comment-row={comment.id}
      data-design-comment-status={comment.status}
      data-highlighted={props.highlighted === comment.id ? "" : undefined}
      onClick={() => {
        if (comment.nodeId) props.onSelect([comment.nodeId])
      }}
    >
      <div data-design-comment-meta>
        <b data-design-comment-index>#{index(comment)}</b>
        <span>{label(comment)}</span>
        <button
          type="button"
          data-design-comment-resolve
          onClick={(event) => {
            event.stopPropagation()
            props.onCommand({ kind: "setCommentResolved", id: comment.id, resolved: comment.status === "open" })
            keepFocus()
          }}
        >
          {t(comment.status === "open" ? "design.studio.comments.resolve" : "design.studio.comments.reopen")}
        </button>
        <button
          type="button"
          data-design-comment-delete
          onClick={(event) => {
            event.stopPropagation()
            props.onCommand({ kind: "deleteComment", id: comment.id })
            keepFocus()
          }}
        >
          {t("design.studio.comments.delete")}
        </button>
      </div>
      <p>{comment.note}</p>
    </li>
  )

  // Reference order (`#designCommentsPanel`): head, thread, then the composer
  // pinned at the bottom of the column.
  return (
    <aside ref={panel} tabindex={-1} data-design-comments-panel>
      <header>
        <div>
          <h2>{t("design.studio.comments")}</h2>
          <span>{t("design.studio.comments.active", { count: String(open().length) })}</span>
        </div>
        <button
          type="button"
          data-design-comments-close
          title={t("design.studio.comments.close")}
          aria-label={t("design.studio.comments.close")}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div data-design-comment-thread>
        <Show when={open().length > 0}>
          <section>
            <h3>{t("design.studio.comments.open")}</h3>
            <ul>
              <For each={open()}>{(comment) => row(comment)}</For>
            </ul>
          </section>
        </Show>
        <Show when={resolved().length > 0}>
          <section>
            <h3>{t("design.studio.comments.resolved")}</h3>
            <ul>
              <For each={resolved()}>{(comment) => row(comment)}</For>
            </ul>
          </section>
        </Show>
      </div>
      <div data-design-comment-composer>
        <p data-design-comment-target={props.target ? (props.target.nodeId ?? "zone") : ""}>
          <Show when={props.target} fallback={t("design.studio.comments.hint")}>
            {(target) => t("design.studio.comments.target", { name: nodeLabel(target().nodeId) })}
          </Show>
        </p>
        <textarea
          placeholder={t("design.studio.comments.placeholder")}
          data-design-comment-note
          value={note()}
          onInput={(event) => setNote(event.currentTarget.value)}
        />
        <button
          type="button"
          data-design-comment-publish
          disabled={!props.target || note().trim().length === 0}
          onClick={publish}
        >
          {t("design.studio.comments.publish")}
        </button>
      </div>
    </aside>
  )
}
