/* SPDX-License-Identifier: MIT */

import { Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"

// The shared entries of a message's hover shelf (ADR-045). Copy, fork and
// revert stay with the message components that own their state.

// WHY disabled: chapters need a persisted marker on the message and a
// navigator to jump between them; neither exists yet, and a button that only
// toggled a local style would lose the pin on reload.
export function PinChapterAction() {
  const i18n = useI18n()
  return (
    <Tooltip value={i18n.t("ui.message.comingSoon")} placement="top" gutter={4}>
      <IconButton
        icon="pin"
        size="normal"
        variant="ghost"
        disabled
        data-slot="message-action-pin"
        aria-label={i18n.t("ui.message.pinChapter")}
      />
    </Tooltip>
  )
}

export function ReadAloudAction(props: { text: string }) {
  const i18n = useI18n()
  return (
    <Tooltip value={i18n.t("ui.message.readAloud")} placement="top" gutter={4}>
      <IconButton
        icon="speaker"
        size="normal"
        variant="ghost"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(event) => {
          event.stopPropagation()
          window.dispatchEvent(new CustomEvent("tts-toggle", { detail: { text: props.text } }))
        }}
        aria-label={i18n.t("ui.message.readAloud")}
      />
    </Tooltip>
  )
}

export function MessageTiming(props: { value: string; title?: string }) {
  return (
    <Show when={props.value}>
      <span data-slot="message-timing" title={props.title || undefined}>
        <Icon name="clock" size="small" />
        <span>{props.value}</span>
      </span>
    </Show>
  )
}
