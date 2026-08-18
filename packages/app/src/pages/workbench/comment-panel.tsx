/* SPDX-License-Identifier: MIT */

import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import {
  EMPTY_COMMENT_STATE,
  addComment,
  commentsForElement,
  markResolved,
  markSent,
  openComments,
  removeComment,
  updateComment,
  type CommentState,
  type DesignComment,
} from "@unifia/workbench-shell"
import { CommentPopover } from "@/pages/workbench/comment-popover"

/**
 * P19 — Panneau latéral listant les commentaires Design d'un artefact.
 *
 * Trois zones : Ouverts (éditables), Envoyés (immutables, P20 câblera
 * l'envoi à l'agent), Résolus (immutables, traçabilité).
 *
 * Le popover (cf. comment-popover.tsx) est affiché inline quand
 * l'utilisateur clique "Ajouter un commentaire". Le commentaire est
 * attaché à l'élément passé via `targetElementId` (l'élément
 * sélectionné via P18 dans une carte future).
 */
export function CommentPanel(props: {
  artifactId: string
  state: CommentState
  targetElementId: string | undefined
  onChange: (state: CommentState) => void
}): JSX.Element {
  const [editingId, setEditingId] = createSignal<string | undefined>()
  const [draft, setDraft] = createSignal("")
  const [popoverOpen, setPopoverOpen] = createSignal(false)

  const open = createMemo(() => openComments(props.state))
  const sent = createMemo(() => props.state.comments.filter((c) => c.status === "sent"))
  const resolved = createMemo(() => props.state.comments.filter((c) => c.status === "resolved"))
  const allForElement = createMemo(() =>
    props.targetElementId ? commentsForElement(props.state, props.targetElementId) : [],
  )

  function add(note: string): void {
    if (!props.targetElementId) return
    const comment: DesignComment = {
      id: crypto.randomUUID(),
      artifactId: props.artifactId,
      elementId: props.targetElementId,
      note,
      status: "open",
      createdAt: new Date().toISOString(),
    }
    props.onChange(addComment(props.state, comment))
    setPopoverOpen(false)
  }

  return (
    <div class="flex flex-col gap-3" data-comment-panel data-comment-panel-artifact={props.artifactId}>
      <div class="flex items-center justify-between">
        <h2 class="text-14-medium">Commentaires</h2>
        <Show when={props.targetElementId}>
          <button
            type="button"
            class="rounded border border-border-base px-2 py-1 text-12-medium"
            data-comment-panel-add
            onClick={() => setPopoverOpen((v) => !v)}
            disabled={!props.targetElementId}
          >
            Ajouter
          </button>
        </Show>
      </div>
      <Show when={!props.targetElementId}>
        <p class="text-12-regular text-text-weak" data-comment-panel-no-target>
          Sélectionnez un élément du rendu pour y attacher un commentaire.
        </p>
      </Show>
      <CommentPopover
        open={popoverOpen()}
        artifactId={props.artifactId}
        elementId={props.targetElementId ?? ""}
        onCreate={(c) => add(c.note)}
        onClose={() => setPopoverOpen(false)}
      />
      <Show when={allForElement().length > 0}>
        <p class="text-12-regular text-text-weak" data-comment-panel-element-count>
          {allForElement().length} commentaire(s) sur <code class="font-mono">{props.targetElementId}</code>
        </p>
      </Show>
      <Show when={open().length > 0}>
        <section data-comment-section="open">
          <h3 class="text-12-medium uppercase tracking-wide text-text-weak">Ouverts ({open().length})</h3>
          <ul class="mt-2 flex flex-col gap-2">
            <For each={open()}>
              {(c) => (
                <li
                  class="rounded border border-border-base bg-background-stronger p-2"
                  data-comment-row={c.id}
                  data-comment-row-status={c.status}
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-10-regular text-text-weak">{c.elementId}</span>
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        class="rounded px-1 text-10-regular text-text-weak hover:text-text-base"
                        data-comment-row-send
                        title="Marquer comme envoyé (P20 câblera le vrai prompt)"
                        onClick={() => props.onChange(markSent(props.state, c.id))}
                      >
                        Envoyer
                      </button>
                      <button
                        type="button"
                        class="rounded px-1 text-10-regular text-text-weak hover:text-text-base"
                        data-comment-row-resolve
                        onClick={() => props.onChange(markResolved(props.state, c.id))}
                      >
                        Résoudre
                      </button>
                      <button
                        type="button"
                        class="rounded px-1 text-10-regular text-text-weak hover:text-text-danger"
                        data-comment-row-delete
                        onClick={() => props.onChange(removeComment(props.state, c.id))}
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                  <Show when={editingId() === c.id} fallback={<p class="mt-1 text-12-regular">{c.note}</p>}>
                    <textarea
                      class="mt-1 min-h-12 w-full rounded border border-border-base bg-background-base p-1 font-mono text-12-regular"
                      data-comment-row-edit-textarea
                      value={draft()}
                      onInput={(e) => setDraft(e.currentTarget.value)}
                    />
                    <div class="mt-1 flex justify-end gap-1">
                      <button type="button" class="rounded px-1 text-10-regular" onClick={() => setEditingId(undefined)}>
                        Annuler
                      </button>
                      <button
                        type="button"
                        class="rounded px-1 text-10-regular"
                        data-comment-row-edit-save
                        onClick={() => {
                          props.onChange(updateComment(props.state, c.id, draft()))
                          setEditingId(undefined)
                        }}
                      >
                        Sauver
                      </button>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={sent().length > 0}>
        <section data-comment-section="sent">
          <h3 class="text-12-medium uppercase tracking-wide text-text-weak">Envoyés ({sent().length})</h3>
          <ul class="mt-2 flex flex-col gap-2">
            <For each={sent()}>
              {(c) => (
                <li class="rounded border border-border-base bg-background-base p-2 opacity-70" data-comment-row={c.id} data-comment-row-status={c.status}>
                  <p class="text-10-regular text-text-weak">{c.elementId}</p>
                  <p class="mt-1 text-12-regular">{c.note}</p>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={resolved().length > 0}>
        <section data-comment-section="resolved">
          <h3 class="text-12-medium uppercase tracking-wide text-text-weak">Résolus ({resolved().length})</h3>
          <ul class="mt-2 flex flex-col gap-1">
            <For each={resolved()}>
              {(c) => (
                <li class="text-12-regular text-text-weak" data-comment-row={c.id} data-comment-row-status={c.status}>
                  {c.elementId} — {c.note}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={open().length === 0 && sent().length === 0 && resolved().length === 0}>
        <p class="text-12-regular text-text-weak" data-comment-panel-empty>
          Aucun commentaire pour l'instant.
        </p>
      </Show>
      <Show when={props.state === EMPTY_COMMENT_STATE}>
        <span data-comment-state="empty" class="hidden" />
      </Show>
    </div>
  )
}
