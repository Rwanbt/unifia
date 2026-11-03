/* SPDX-License-Identifier: MIT */

import { TextField } from "@unifia/ui/text-field"

import { Show, createSignal, type JSX } from "solid-js"
import { newCommentId, type DesignComment } from "@unifia/workbench-shell"
import { useLanguage } from "@/context/language"
import { tDesignArtifact } from "@/i18n/design-artifact"

/**
 * P19 — Popover de saisie d'un commentaire attaché à un élément
 * (identifié par son `data-unifia-id`).
 *
 * Le composant est *controlled* : `open`, `onClose`, `onCreate` sont
 * fournis par le parent (panneau ou toolbar). Le state local se limite
 * à la note en cours de saisie. Libellés via `tDesignArtifact`.
 */
export function CommentPopover(props: {
  open: boolean
  artifactId: string
  elementId: string
  onCreate: (comment: DesignComment) => void
  onClose: () => void
}): JSX.Element {
  const language = useLanguage()
  const tr = (key: Parameters<typeof tDesignArtifact>[1]) => tDesignArtifact(language.locale(), key)
  const [note, setNote] = createSignal("")
  function submit(): void {
    const value = note().trim()
    if (!value) return
    const comment: DesignComment = {
      id: newCommentId(),
      artifactId: props.artifactId,
      elementId: props.elementId,
      note: value,
      status: "open",
      createdAt: new Date().toISOString(),
    }
    props.onCreate(comment)
    setNote("")
    props.onClose()
  }
  return (
    <Show when={props.open}>
      <div
        class="flex flex-col gap-2 rounded-lg border border-border-base bg-background-stronger p-3 shadow-md"
        data-comment-popover
        data-comment-popover-element={props.elementId}
        role="dialog"
        aria-label={tr("comments.title")}
      >
        <p class="text-12-medium" data-comment-popover-target>
          {tr("comments.popover.target")} <code class="font-mono">{props.elementId}</code>
        </p>
        <TextField
          multiline
          class="min-h-16"
          label={tr("comments.popover.placeholder")}
          hideLabel
          data-comment-popover-textarea
          placeholder={tr("comments.popover.placeholder")}
          value={note()}
          onInput={(event) => setNote(event.currentTarget.value)}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              props.onClose()
            }
          }}
          autofocus
        />
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="flex min-h-9 items-center rounded border border-border-base px-3 text-12-regular"
            data-comment-popover-cancel
            onClick={() => props.onClose()}
          >
            {tr("comments.cancel")}
          </button>
          <button
            type="button"
            class="flex min-h-9 items-center rounded bg-[var(--button-primary-base)] px-3 text-12-medium text-[var(--icon-invert-base)] disabled:opacity-50"
            data-comment-popover-submit
            disabled={note().trim().length === 0}
            onClick={() => submit()}
          >
            {tr("comments.add")}
          </button>
        </div>
      </div>
    </Show>
  )
}
