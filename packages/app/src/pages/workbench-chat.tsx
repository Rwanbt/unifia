/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

type WorkbenchChatProps = {
  mode: "work" | "design" | "automate"
  directory: string | undefined
  sessionId: string | undefined
  prompt: string
  description: string
}

const MODE_KEY = {
  work: "workbench.chat.work",
  design: "workbench.chat.design",
  automate: "workbench.chat.automate",
} as const

function messageText(parts: readonly { type: string; text?: string }[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export function WorkbenchChat(props: WorkbenchChatProps): JSX.Element {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const t = language.t
  const [input, setInput] = createSignal("")
  const [activeSessionId, setActiveSessionId] = createSignal(props.sessionId)
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const modeTitle = () => t(MODE_KEY[props.mode])
  const modeTitleSession = () => t("workbench.chat.sessionTitle", { mode: modeTitle() })

  createEffect(() => {
    const incomingSessionId = props.sessionId
    if (incomingSessionId && incomingSessionId !== activeSessionId()) setActiveSessionId(incomingSessionId)
  })

  createEffect(() => {
    const sessionId = activeSessionId()
    if (sessionId) void sync.session.sync(sessionId).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  })

  const messages = createMemo(() => {
    const sessionId = activeSessionId()
    if (!sessionId) return []
    return (sync.data.message[sessionId] ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      text: messageText(sync.data.part[message.id]),
    })).filter((message) => message.text)
  })

  async function submit(): Promise<void> {
    const text = input().trim()
    if (!text || sending() || !props.directory) return
    setSending(true)
    setError(undefined)
    try {
      let sessionId = activeSessionId()
      if (!sessionId) {
        const result = await sdk.client.session.create({ directory: props.directory, title: modeTitleSession() })
        sessionId = result.data?.id
        if (!sessionId) throw new Error(t("workbench.errors.sessionCreation"))
        setActiveSessionId(sessionId)
      }
      await sdk.client.session.prompt({ sessionID: sessionId, agent: "build", parts: [{ type: "text", text }] })
      setInput("")
      await sync.session.sync(sessionId, { force: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }

  function applySuggestion(): void {
    setInput(props.prompt)
  }

  return (
    <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-workbench-chat={props.mode}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-16-medium">{modeTitle()}</h2>
          <p class="mt-1 text-12-regular text-text-weak">{props.description}</p>
        </div>
        <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" data-workbench-chat-suggestion onClick={applySuggestion}>
          {t("workbench.chat.tryExample")}
        </button>
      </div>
      <Show when={messages().length > 0}>
        <div class="mt-4 max-h-56 space-y-2 overflow-y-auto" aria-live="polite" data-workbench-chat-history>
          <For each={messages()}>
            {(message) => (
              <article class="rounded-md border border-border-weak-base bg-background-base px-3 py-2" data-workbench-chat-message={message.role}>
                <p class="text-12-medium text-text-weak">{message.role === "user" ? t("workbench.chat.you") : t("workbench.chat.assistant")}</p>
                <p class="mt-1 whitespace-pre-wrap text-14-regular text-text-base">{message.text}</p>
              </article>
            )}
          </For>
        </div>
      </Show>
      <form class="mt-4 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label class="sr-only" for={`workbench-chat-${props.mode}`}>{t("workbench.chat.messageFor", { mode: modeTitle() })}</label>
        <textarea
          id={`workbench-chat-${props.mode}`}
          class="min-h-24 w-full resize-y rounded-md border border-border-base bg-background-base p-3 text-14-regular text-text-base"
          data-workbench-chat-input
          placeholder={props.prompt}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          disabled={sending()}
        />
        <div class="flex items-center justify-between gap-3">
          <p class="text-12-regular text-text-weak">{t("workbench.chat.reviewResult")}</p>
          <button type="submit" class="rounded bg-surface-inset-base px-3 py-2 text-12-medium text-text-strong" data-workbench-chat-submit disabled={!input().trim() || sending()}>
            {sending() ? t("workbench.chat.sending") : t("workbench.chat.send")}
          </button>
        </div>
      </form>
      <Show when={error()}>
        <p class="mt-3 text-12-regular text-text-danger" role="alert" data-workbench-chat-error>{error()}</p>
      </Show>
    </section>
  )
}
