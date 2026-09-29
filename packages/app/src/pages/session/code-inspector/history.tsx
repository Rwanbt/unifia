/* SPDX-License-Identifier: MIT */

// History -- reference checkpoints ("Checkpoint #n · Before “…”") with
// Restore / Compare / Create branch. Each user turn of the session is a
// restore point: Restore rewinds the session to just before it through the
// session's own revert mutation. Manual checkpoints, compare and branch have
// no backend and stay greyed (ADR-049).

import { createMemo, For, Show, type JSX } from "solid-js"
import type { TextPart, UserMessage } from "../../../types/sdk-shim"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { Actions, Card, Empty, Soon } from "./parts"

const clock = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

export function CodeHistory(props: {
  sessionId: string | undefined
  restore: (messageID: string) => void
  busy: boolean
}): JSX.Element {
  const language = useLanguage()
  const sync = useSync()

  const turns = createMemo(() => {
    const id = props.sessionId
    if (!id) return []
    const users = (sync.data.message[id] ?? []).filter((message): message is UserMessage => message.role === "user")
    return users.map((message, index) => ({ message, index: index + 1 })).reverse()
  })

  const excerpt = (message: UserMessage) => {
    const text = (sync.data.part[message.id] ?? []).find((part): part is TextPart => part.type === "text" && !part.synthetic)
    const line = text?.text.trim().split("\n")[0] ?? ""
    return line.length > 48 ? `${line.slice(0, 47)}…` : line
  }

  const soon = () => language.t("inspector.code.soon")

  return (
    <>
      <Actions>
        <Soon label={`＋ ${language.t("inspector.code.history.checkpoint")}`} hint={soon()} primary />
      </Actions>
      <Show when={turns().length > 0} fallback={<Empty>{language.t("inspector.code.history.none")}</Empty>}>
        <For each={turns()}>
          {(turn) => (
            <Card title={language.t("inspector.code.history.title", { index: turn.index, text: excerpt(turn.message) })}>
              <p>{clock(turn.message.time.created)}</p>
              <Actions>
                <button type="button" disabled={props.busy} onClick={() => props.restore(turn.message.id)}>
                  {language.t("inspector.code.history.restore")}
                </button>
                <Soon label={language.t("inspector.code.history.compare")} hint={soon()} />
                <Soon label={language.t("inspector.code.history.branch")} hint={soon()} />
              </Actions>
            </Card>
          )}
        </For>
      </Show>
    </>
  )
}
