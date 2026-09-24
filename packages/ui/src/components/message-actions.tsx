/* SPDX-License-Identifier: MIT */

import { Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { useChapters } from "../context/chapters"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"

// The shared entries of a message's hover shelf (ADR-045). Copy, fork and
// revert stay with the message components that own their state.

/** Pins the message as a chapter (ADR-052); disabled when the host keeps no chapters. */
export function PinChapterAction(props: { messageID: string }) {
  const i18n = useI18n()
  const chapters = useChapters()
  const pinned = () => chapters?.pinned(props.messageID) ?? false
  const label = () =>
    !chapters
      ? i18n.t("ui.message.comingSoon")
      : pinned()
        ? i18n.t("ui.message.unpinChapter")
        : i18n.t("ui.message.pinChapter")
  return (
    <Tooltip value={label()} placement="top" gutter={4}>
      <IconButton
        icon="pin"
        size="normal"
        variant="ghost"
        disabled={!chapters}
        data-slot="message-action-pin"
        data-active={pinned() ? "" : undefined}
        aria-pressed={chapters ? pinned() : undefined}
        aria-label={i18n.t("ui.message.pinChapter")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(event) => {
          event.stopPropagation()
          chapters?.toggle(props.messageID)
        }}
      />
    </Tooltip>
  )
}

/** The reference's "Chapitre" tag above a pinned message. */
export function ChapterLabel() {
  const i18n = useI18n()
  return <span data-slot="chapter-label">{i18n.t("ui.message.chapter")}</span>
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
