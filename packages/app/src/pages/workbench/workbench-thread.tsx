/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { Markdown } from "@unifia/ui/markdown"
import { Button } from "@unifia/ui/button"
import { DockShellForm, DockTray } from "@unifia/ui/dock-surface"
import { createWorkbenchSession } from "@/pages/workbench/workbench-session"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import {
  addPendingSend,
  extractMessageText,
  findRegenerateTarget,
  markPendingSendFailed,
  markPendingSendRetrying,
  removePendingSend,
  selectNextStepSuggestions,
  type NextStepSuggestion,
  type PendingSend,
} from "@/pages/workbench/workbench-thread-shared"

export type WorkbenchThreadProps = {
  mode: "work" | "design" | "automate"
  /** Placeholder shown in the composer; matches the chat semantics. */
  prompt: string
  /** Subtitle of the conversation header. */
  description: string
  /** Connection attribute names for the banner, taken from `ConnectionBanner` props. */
  connection: {
    dataAttr: "workbench-connection" | "design-connection" | "automate-connection"
    dataRetryAttr: "workbench-retry" | "design-retry" | "automate-retry"
  }
}

const MODE_KEY = {
  work: "workbench.chat.work",
  design: "workbench.chat.design",
  automate: "workbench.chat.automate",
} as const

/**
 * The Open Design chat column, ported for Unifia.
 *
 * Open Design is a conversation that owns the column: a sticky header, a
 * scrolling list, and a composer that is a SIBLING of the list (not a
 * descendant) so the input stays anchored while the messages scroll.
 * Unifia previously inlined the same conversation inside a single card
 * (`max-h-56` scrollable region inside a card), which made the editor read
 * as a spec page with a chat widget instead of a conversation with an
 * artifact atelier.
 *
 * Why the composer is a sibling of the list and not a child: a child composer
 * inside a `flex-1 overflow-y-auto` list scrolls away with the last message,
 * which is what we were seeing — the input disappeared the moment the
 * assistant answered. Open Design avoids that by giving the composer its own
 * row beneath the scrollable region.
 *
 * Phase 7 — visual parity with the Code session chat. The message bubbles
 * reuse the exact `[data-component="user-message"]` / `[data-component="text-part"]`
 * slot markup that `@unifia/ui`'s `message-part.css` already styles for the
 * Code mode timeline (see `packages/ui/src/components/message-part.css`).
 * Reusing the CSS selectors gives pixel parity without importing `SessionTurn`
 * itself — that component (and `message-part.tsx`) is wired to `useData()` /
 * `useFileComponent()`, context providers that only exist above the Code
 * session route. Importing it here would mean mounting that provider tree
 * under Workbench too, which is an architecture change this pass doesn't
 * need: the ask was visual parity, not functional parity with tool-call
 * rendering. The composer shell reuses `DockShellForm` / `DockTray` from
 * `@unifia/ui/dock-surface` for the same reason — same rounded-card chrome
 * as `PromptInput`, zero context dependency.
 */
export function WorkbenchThread(props: WorkbenchThreadProps): JSX.Element {
  const sync = useSync()
  const language = useLanguage()
  const t = language.t
  const [input, setInput] = createSignal("")
  const [regenerating, setRegenerating] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [feedback, setFeedback] = createSignal<Record<string, "like" | "dislike" | undefined>>({})
  // Phase 10.2 — each composer submission that hasn't landed in
  // `sync.data` yet lives here, not behind a single `sending` gate: two
  // concurrent sends must be able to fail independently, each with its
  // own Retry button (see PendingSend in workbench-thread-shared.ts).
  const [pendingSends, setPendingSends] = createSignal<readonly PendingSend[]>([])

  const modeTitle = () => t(MODE_KEY[props.mode])
  const modeTitleSession = () => t("workbench.chat.sessionTitle", { mode: modeTitle() })
  // The session is owned by the route, not by this thread: every Workbench
  // surface of the workspace shows the same conversation.
  const session = createWorkbenchSession({ title: modeTitleSession })
  const activeSessionId = session.id

  createEffect(() => {
    const sessionId = activeSessionId()
    if (sessionId) void sync.session.sync(sessionId).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  })

  const messages = createMemo(() => {
    const sessionId = activeSessionId()
    if (!sessionId) return []
    return (sync.data.message[sessionId] ?? [])
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: extractMessageText(sync.data.part[message.id]),
      }))
      .filter((message) => message.text)
  })

  const lastAssistantId = createMemo(() => {
    const list = messages()
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]?.role === "assistant") return list[i]?.id
    }
    return undefined
  })

  async function submit(): Promise<void> {
    const text = input().trim()
    if (!text) return
    setInput("")
    const id = crypto.randomUUID()
    setPendingSends((list) => addPendingSend(list, id, text))
    await sendPending(id, text)
  }

  /** Phase 10.2 — the actual send, shared by `submit()` and `retryPendingSend()`. */
  async function sendPending(id: string, text: string): Promise<void> {
    try {
      await session.prompt(text)
      setPendingSends((list) => removePendingSend(list, id))
    } catch {
      // The generic bottom-of-thread error banner is gone for send
      // failures specifically — the failed bubble itself carries its own
      // Retry button now (porte: two concurrent failures, two independent
      // buttons). `error` stays reserved for non-send failures (session
      // sync, below).
      setPendingSends((list) => markPendingSendFailed(list, id))
    }
  }

  function retryPendingSend(id: string): void {
    const target = pendingSends().find((p) => p.id === id)
    if (!target) return
    setPendingSends((list) => markPendingSendRetrying(list, id))
    void sendPending(id, target.text)
  }

  function applySuggestion(suggestion: NextStepSuggestion): void {
    setInput(suggestion.prompt)
  }

  /**
   * Phase 10.1 — reverts to the user message that prompted
   * `assistantMessageId` (excluding it and the answer being regenerated
   * from active history) and resends its exact text. See `revert`'s doc
   * comment in `workbench-session.ts` for why this can't duplicate the
   * user message.
   */
  async function regenerate(assistantMessageId: string): Promise<void> {
    if (regenerating()) return
    const target = findRegenerateTarget(messages(), assistantMessageId)
    if (!target) return
    setRegenerating(true)
    setError(undefined)
    try {
      await session.revert(target.userMessageId)
      await session.prompt(target.userText)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRegenerating(false)
    }
  }

  async function copyMessage(messageId: string, text: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(text)
      setFeedback((current) => ({ ...current, [messageId]: "like" }))
    } catch {
      // Clipboard refused (permissions, secure context missing): the user
      // already sees the message, nothing actionable for us to surface.
    }
  }

  function rate(messageId: string, value: "like" | "dislike"): void {
    setFeedback((current) => ({ ...current, [messageId]: value }))
  }

  const suggestions = (): readonly NextStepSuggestion[] => selectNextStepSuggestions(props.mode)

  return (
    <section class="flex h-full min-h-0 flex-col" data-workbench-thread={props.mode}>
      <header
        class="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-border-base bg-background-stronger px-4 py-3"
        data-workbench-thread-header
      >
        <div class="min-w-0">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{modeTitle()}</p>
          <h1 class="mt-1 truncate text-16-medium text-text-strong">{props.description}</h1>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded border border-border-base px-2 py-1 text-12-regular"
            data-workbench-thread-comment
            aria-label="Commenter la conversation"
            title="Commenter la conversation"
          >
            Commenter
          </button>
        </div>
      </header>
      <div class="border-b border-border-base px-4 py-2" data-workbench-thread-connection>
        <ConnectionBanner dataAttr={props.connection.dataAttr} dataRetryAttr={props.connection.dataRetryAttr} />
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3" data-workbench-thread-history aria-live="polite">
        <Show
          when={messages().length > 0 || pendingSends().length > 0}
          fallback={
            <p class="text-12-regular text-text-weak" data-workbench-thread-empty>
              Démarre la conversation par un message. Le fil reste affiché quand tu changes de mode.
            </p>
          }
        >
          <ul class="flex flex-col gap-6" data-workbench-thread-list>
            <For each={messages()}>
              {(message) => (
                <li data-workbench-thread-message={message.role}>
                  <Show
                    when={message.role === "user"}
                    fallback={
                      <div data-component="assistant-message" data-workbench-thread-message-body>
                        <div data-component="text-part">
                          <div data-slot="text-part-body">
                            <Markdown text={message.text} cacheKey={message.id} />
                          </div>
                          <Show when={message.id === lastAssistantId()}>
                            <div data-slot="text-part-copy-wrapper" data-workbench-thread-execution>
                              <button
                                type="button"
                                class="rounded border border-border-base px-2 py-1 text-12-regular"
                                data-workbench-thread-action="copy"
                                onClick={() => void copyMessage(message.id, message.text)}
                              >
                                Copier
                              </button>
                              <button
                                type="button"
                                class="rounded border border-border-base px-2 py-1 text-12-regular disabled:opacity-50"
                                data-workbench-thread-action="regenerate"
                                title="Régénérer la réponse"
                                disabled={regenerating()}
                                onClick={() => void regenerate(message.id)}
                              >
                                Régénérer
                              </button>
                              <button
                                type="button"
                                class="rounded border border-border-base px-2 py-1 text-12-regular"
                                classList={{ "border-border-focus": feedback()[message.id] === "like" }}
                                data-workbench-thread-action="like"
                                aria-pressed={feedback()[message.id] === "like"}
                                onClick={() => rate(message.id, "like")}
                                title="Réponse utile"
                              >
                                👍
                              </button>
                              <button
                                type="button"
                                class="rounded border border-border-base px-2 py-1 text-12-regular"
                                classList={{ "border-border-focus": feedback()[message.id] === "dislike" }}
                                data-workbench-thread-action="dislike"
                                aria-pressed={feedback()[message.id] === "dislike"}
                                onClick={() => rate(message.id, "dislike")}
                                title="Réponse à améliorer"
                              >
                                👎
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    }
                  >
                    <div data-component="user-message" data-workbench-thread-message-body>
                      <div data-slot="user-message-body">
                        <div data-slot="user-message-text">{message.text}</div>
                      </div>
                      <div data-slot="user-message-copy-wrapper">
                        <span data-slot="user-message-meta">{t("workbench.chat.you")}</span>
                      </div>
                    </div>
                  </Show>
                </li>
              )}
            </For>
            <For each={pendingSends()}>
              {(pending) => (
                <li data-workbench-thread-message="user" data-workbench-thread-pending={pending.status}>
                  <div data-component="user-message" data-workbench-thread-message-body>
                    <div data-slot="user-message-body">
                      <div data-slot="user-message-text">{pending.text}</div>
                    </div>
                    <div data-slot="user-message-copy-wrapper">
                      <span data-slot="user-message-meta">{t("workbench.chat.you")}</span>
                    </div>
                  </div>
                  <Show when={pending.status === "failed"}>
                    <div class="mt-1 flex items-center gap-2" data-workbench-thread-pending-error>
                      <p class="text-12-regular text-text-danger" role="alert">
                        {t("workbench.chat.sendFailed")}
                      </p>
                      <button
                        type="button"
                        class="rounded border border-border-base px-2 py-1 text-12-regular"
                        data-workbench-thread-action="retry"
                        onClick={() => retryPendingSend(pending.id)}
                      >
                        {t("workbench.chat.retry")}
                      </button>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={messages().length > 0}>
            <section
              class="mt-4 rounded-md border border-border-weak-base bg-background-stronger p-3"
              data-workbench-thread-next-step
            >
              <p class="text-12-medium text-text-weak">Étapes suivantes</p>
              <p class="mt-1 text-12-regular text-text-weak">
                Quelques suggestions pour continuer la conversation.
              </p>
              <ul class="mt-2 flex flex-col gap-1">
                <For each={suggestions()}>
                  {(suggestion) => (
                    <li>
                      <button
                        type="button"
                        class="w-full rounded border border-border-base bg-background-base px-2 py-1 text-left text-12-regular"
                        data-workbench-thread-next-step-suggestion={suggestion.id}
                        onClick={() => applySuggestion(suggestion)}
                      >
                        {suggestion.label}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>
        </Show>
      </div>
      <DockShellForm
        class="mx-4 mb-3 mt-2 flex flex-col"
        data-workbench-thread-composer
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label class="sr-only" for={`workbench-thread-${props.mode}`}>
          {t("workbench.chat.messageFor", { mode: modeTitle() })}
        </label>
        <textarea
          id={`workbench-thread-${props.mode}`}
          class="min-h-24 w-full resize-y bg-transparent px-3 pt-3 text-14-regular text-text-strong placeholder:text-text-weak focus:outline-none"
          data-workbench-thread-input
          placeholder={props.prompt}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
        />
        <DockTray attach="top" class="flex items-center justify-between gap-3 px-3 py-2">
          <p class="text-12-regular text-text-weak">{t("workbench.chat.reviewResult")}</p>
          <Button
            type="submit"
            variant="primary"
            size="normal"
            data-workbench-thread-submit
            disabled={!input().trim()}
          >
            {pendingSends().some((p) => p.status === "sending") ? t("workbench.chat.sending") : t("workbench.chat.send")}
          </Button>
        </DockTray>
      </DockShellForm>
      <Show when={error()}>
        <p class="mx-4 mb-2 text-12-regular text-text-danger" role="alert" data-workbench-thread-error>
          {error()}
        </p>
      </Show>
    </section>
  )
}
