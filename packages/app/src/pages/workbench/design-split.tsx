/* SPDX-License-Identifier: MIT */

import { Show, type JSX, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import {
  DEFAULT_CHAT_WIDTH,
  KEYBOARD_STEP,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
  clampChatWidth,
} from "@/pages/workbench/design-split-clamp"

export {
  clampChatWidth,
  DEFAULT_CHAT_WIDTH,
  KEYBOARD_STEP,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
}

export function DesignSplit(props: { chat: JSX.Element; workspace: JSX.Element }): JSX.Element {
  const language = useLanguage()
  const directory = useMode().directory
  const t = language.t
  const [preferences, setPreferences] = persisted(
    Persist.workspace(directory() ?? "", "design-split.v1"),
    createStore<{ chatWidth: number }>({ chatWidth: DEFAULT_CHAT_WIDTH }),
  )
  const [focused, setFocused] = createSignal(false)
  const [resizing, setResizing] = createSignal(false)

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    setResizing(true)
    const startX = event.clientX
    const startWidth = clampChatWidth(preferences.chatWidth)
    function onMove(e: PointerEvent): void {
      const next = clampChatWidth(startWidth + (e.clientX - startX))
      setPreferences("chatWidth", next)
    }
    function onUp(): void {
      setResizing(false)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  onCleanup(() => {
    document.body.style.userSelect = ""
  })

  function onKey(event: KeyboardEvent): void {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setPreferences("chatWidth", clampChatWidth(preferences.chatWidth - KEYBOARD_STEP))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setPreferences("chatWidth", clampChatWidth(preferences.chatWidth + KEYBOARD_STEP))
    } else if (event.key === "Home") {
      event.preventDefault()
      setPreferences("chatWidth", DEFAULT_CHAT_WIDTH)
    }
  }

  const gridTemplate = createMemo(() =>
    focused() ? "minmax(0, 1fr)" : `var(--design-chat-width, ${DEFAULT_CHAT_WIDTH}px) 8px minmax(400px, 1fr)`,
  )

  return (
    <div
      class="grid size-full [&.is-resizing_iframe]:pointer-events-none"
      classList={{ "is-resizing": resizing() }}
      style={{
        "grid-template-columns": gridTemplate(),
        "--design-chat-width": `${clampChatWidth(preferences.chatWidth)}px`,
      }}
      data-design-split-focused={focused() ? "true" : "false"}
    >
      <div class="flex h-full min-w-0 flex-col overflow-hidden" hidden={focused()} data-design-split-chat>
        {props.chat}
      </div>
      <Show when={!focused()}>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("design.split.handle")}
          aria-valuenow={clampChatWidth(preferences.chatWidth)}
          aria-valuemin={MIN_CHAT_WIDTH}
          aria-valuemax={MAX_CHAT_WIDTH}
          tabindex="0"
          class="w-2 cursor-col-resize select-none bg-border-base hover:bg-border-focus focus:bg-border-focus focus:outline-none"
          data-design-split-handle
          onPointerDown={startResize}
          onKeyDown={onKey}
        />
      </Show>
      <div class="flex h-full min-w-0 flex-col overflow-hidden" data-design-split-workspace>
        {props.workspace}
      </div>
    </div>
  )
}
