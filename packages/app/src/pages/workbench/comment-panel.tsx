/* SPDX-License-Identifier: MIT */

import { TextField } from "@unifia/ui/text-field"

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import {
  EMPTY_COMMENT_STATE,
  addComment,
  buildRefineBatchPrompt,
  canSend,
  commentsForElement,
  markResolved,
  markSent,
  openComments,
  removeComment,
  updateComment,
  type CommentState,
  type CommentTargetRect,
  type DesignComment,
} from "@unifia/workbench-shell"
import { CommentPopover } from "@/pages/workbench/comment-popover"
import { useLanguage } from "@/context/language"
import { tDesignArtifact, type DesignArtifactKey } from "@/i18n/design-artifact"

/**
 * P19 + P20 — Panneau latéral listant les commentaires Design d'un
 * artefact ET câblant l'envoi à l'agent.
 *
 * Trois zones : Ouverts (éditables, envoyables), Envoyés (immutables,
 * P20 marque `sent` après l'envoi), Résolus (immutables, traçabilité).
 *
 * P20 — Le bouton "Tout envoyer" duplique le contenu de chaque open
 * via `buildRefineBatchPrompt` et appelle `props.onSendBatch(prompt)`.
 * Le parent (design-surface) décide comment router le prompt vers
 * l'agent (typiquement `session.prompt` avec un agent "build" dédié).
 */
export function CommentPanel(props: {
  artifactId: string
  state: CommentState
  entryFile: string
  targetElementId: string | undefined
  /** Phase 8.1 — rect du pick en cours, attaché au commentaire créé pour que son épingle sache où se dessiner. */
  targetRect: CommentTargetRect | undefined
  /** Phase 8.1 — id du commentaire à faire défiler en vue (clic sur une épingle). */
  highlightedCommentId: string | undefined
  onChange: (state: CommentState) => void
  onSendBatch: (prompt: string) => void
  onSendOne: (prompt: string) => void
  /** Attaches one comment to the shared chat composer as a context chip. */
  onAttach?: (comment: DesignComment) => void
  /** Ids already attached to the composer, so the button can say so. */
  attachedIds?: ReadonlySet<string>
  onClose?: () => void
}): JSX.Element {
  const language = useLanguage()
  const tr = (key: DesignArtifactKey, params?: Record<string, string>) => tDesignArtifact(language.locale(), key, params)
  const [editingId, setEditingId] = createSignal<string | undefined>()
  const [draft, setDraft] = createSignal("")
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const rowRefs = new Map<string, HTMLLIElement>()

  createEffect(() => {
    const id = props.highlightedCommentId
    if (!id) return
    rowRefs.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  })

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
      rect: props.targetRect,
    }
    props.onChange(addComment(props.state, comment))
    setPopoverOpen(false)
  }

  function sendOne(commentId: string): void {
    const c = props.state.comments.find((x) => x.id === commentId)
    if (!c || !canSend(c)) return
    const prompt = buildRefineBatchPrompt({
      artifactId: props.artifactId,
      entryFile: props.entryFile,
      comments: { comments: [c] },
    })
    setSending(true)
    props.onSendOne(prompt)
    props.onChange(markSent(props.state, commentId))
    setSending(false)
  }

  function sendBatch(): void {
    if (open().length === 0) return
    const prompt = buildRefineBatchPrompt({
      artifactId: props.artifactId,
      entryFile: props.entryFile,
      comments: props.state,
    })
    setSending(true)
    props.onSendBatch(prompt)
    // Marque tous les open comme sent
    let next = props.state
    for (const c of open()) {
      next = markSent(next, c.id)
    }
    props.onChange(next)
    setSending(false)
  }

  const secondary =
    "flex min-h-9 items-center rounded px-2 text-12-regular text-text-weak hover:bg-background-base hover:text-text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus disabled:opacity-50"
  const primary =
    "flex min-h-9 items-center rounded bg-[var(--button-primary-base)] px-3 text-12-medium text-[var(--icon-invert-base)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:opacity-50"

  return (
    <div class="flex flex-col gap-3" data-comment-panel data-comment-panel-artifact={props.artifactId}>
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-14-medium">{tr("comments.title")}</h2>
        <div class="flex items-center gap-1">
          <Show when={props.targetElementId}>
            <button
              type="button"
              class="flex min-h-9 items-center rounded border border-border-base px-3 text-12-medium hover:bg-background-base"
              data-comment-panel-add
              onClick={() => setPopoverOpen((v) => !v)}
              disabled={!props.targetElementId}
            >
              {tr("comments.add")}
            </button>
          </Show>
          <Show when={props.onClose}>
            <button
              type="button"
              class="flex size-9 items-center justify-center rounded text-14-regular text-text-weak hover:bg-background-base hover:text-text-base"
              aria-label={tr("comments.close")}
              data-comment-panel-close
              onClick={() => props.onClose?.()}
            >
              ×
            </button>
          </Show>
        </div>
      </div>
      <Show when={!props.targetElementId}>
        <p class="text-12-regular text-text-weak" data-comment-panel-no-target>
          {tr("comments.noTarget")}
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
          {tr("comments.elementCount", { count: String(allForElement().length) })} <code class="font-mono">{props.targetElementId}</code>
        </p>
      </Show>
      <Show when={open().length > 0}>
        <section data-comment-section="open">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-12-medium uppercase tracking-wide text-text-weak">{tr("comments.open", { count: String(open().length) })}</h3>
            <button
              type="button"
              class={primary}
              data-comment-panel-send-all
              disabled={open().length === 0 || sending()}
              onClick={() => sendBatch()}
              title={tr("comments.sendAll.tooltip")}
            >
              {sending() ? tr("comments.sending") : tr("comments.sendAll", { count: String(open().length) })}
            </button>
          </div>
          <ul class="mt-2 flex flex-col gap-2">
            <For each={open()}>
              {(c) => (
                <li
                  ref={(element) => rowRefs.set(c.id, element)}
                  class="rounded border p-2"
                  classList={{
                    "border-border-focus bg-background-base": props.highlightedCommentId === c.id,
                    "border-border-base bg-background-stronger": props.highlightedCommentId !== c.id,
                  }}
                  data-comment-row={c.id}
                  data-comment-row-status={c.status}
                >
                  <span class="block truncate font-mono text-10-regular text-text-weak">{c.elementId}</span>
                  <Show when={editingId() === c.id} fallback={<p class="mt-1 whitespace-pre-wrap break-words text-12-regular">{c.note}</p>}>
                    <TextField
                      multiline
                      class="min-h-16"
                      label={tr("comments.note")}
                      hideLabel
                      data-comment-row-edit-textarea
                      value={draft()}
                      onInput={(e) => setDraft(e.currentTarget.value)}
                    />
                    <div class="mt-1 flex justify-end gap-1">
                      <button type="button" class={secondary} onClick={() => setEditingId(undefined)}>
                        {tr("comments.cancel")}
                      </button>
                      <button
                        type="button"
                        class={primary}
                        data-comment-row-edit-save
                        disabled={draft().trim().length === 0}
                        onClick={() => {
                          props.onChange(updateComment(props.state, c.id, draft()))
                          setEditingId(undefined)
                        }}
                      >
                        {tr("comments.save")}
                      </button>
                    </div>
                  </Show>
                  <Show when={editingId() !== c.id}>
                    <div class="mt-1 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        class={primary}
                        data-comment-row-send-one
                        title={tr("comments.send.tooltip")}
                        onClick={() => sendOne(c.id)}
                      >
                        {tr("comments.send")}
                      </button>
                      <Show when={props.onAttach}>
                        <button
                          type="button"
                          class={secondary}
                          data-comment-row-attach
                          disabled={props.attachedIds?.has(c.id) === true}
                          title={tr("comments.attach.tooltip")}
                          onClick={() => props.onAttach?.(c)}
                        >
                          {props.attachedIds?.has(c.id) ? tr("comments.attached") : tr("comments.attach")}
                        </button>
                      </Show>
                      <button
                        type="button"
                        class={secondary}
                        data-comment-row-edit
                        onClick={() => {
                          setDraft(c.note)
                          setEditingId(c.id)
                        }}
                      >
                        {tr("comments.edit")}
                      </button>
                      <button
                        type="button"
                        class={secondary}
                        data-comment-row-resolve
                        onClick={() => props.onChange(markResolved(props.state, c.id))}
                      >
                        {tr("comments.resolve")}
                      </button>
                      <button
                        type="button"
                        class={`${secondary} hover:text-text-danger`}
                        data-comment-row-delete
                        onClick={() => props.onChange(removeComment(props.state, c.id))}
                      >
                        {tr("comments.delete")}
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
          <h3 class="text-12-medium uppercase tracking-wide text-text-weak">{tr("comments.sent", { count: String(sent().length) })}</h3>
          <ul class="mt-2 flex flex-col gap-2">
            <For each={sent()}>
              {(c) => (
                <li
                  class="rounded border border-border-base bg-background-base p-2 opacity-70"
                  data-comment-row={c.id}
                  data-comment-row-status={c.status}
                >
                  <p class="truncate font-mono text-10-regular text-text-weak">{c.elementId}</p>
                  <p class="mt-1 whitespace-pre-wrap break-words text-12-regular">{c.note}</p>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={resolved().length > 0}>
        <section data-comment-section="resolved">
          <h3 class="text-12-medium uppercase tracking-wide text-text-weak">{tr("comments.resolved", { count: String(resolved().length) })}</h3>
          <ul class="mt-2 flex flex-col gap-1">
            <For each={resolved()}>
              {(c) => (
                <li class="break-words text-12-regular text-text-weak" data-comment-row={c.id} data-comment-row-status={c.status}>
                  {c.elementId} — {c.note}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={open().length === 0 && sent().length === 0 && resolved().length === 0}>
        <p class="text-12-regular text-text-weak" data-comment-panel-empty>
          {tr("comments.empty")}
        </p>
      </Show>
      <Show when={props.state === EMPTY_COMMENT_STATE}>
        <span data-comment-state="empty" class="hidden" />
      </Show>
    </div>
  )
}
