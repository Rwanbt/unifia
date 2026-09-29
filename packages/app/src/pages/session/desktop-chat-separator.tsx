/* SPDX-License-Identifier: MIT */

import { createMemo } from "solid-js"
import { createElementSize } from "@solid-primitives/resize-observer"
import { Separator } from "../../primitives/separator"
import { CHAT_MIN_WIDTH, chatMaxWidth } from "./chat-width"

/**
 * The split chat's right-edge handle -- the reference's
 * `.mode-chat > .panel-resizer[data-resize="chat"]`: a 14px hit area with a
 * 2px line on hover, keyboard-operable through the shared Separator. The
 * host mounts it only in the desktop split layout.
 */
export interface DesktopChatSeparatorProps {
  chat: HTMLElement | undefined
  workspace: HTMLElement | undefined
  label: string
  onStart: () => void
  onResize: (width: number) => void
}

export function DesktopChatSeparator(props: DesktopChatSeparatorProps) {
  const chat = createElementSize(() => props.chat)
  const workspace = createElementSize(() => props.workspace)
  const max = createMemo(() => chatMaxWidth(workspace.width ?? 0))

  return (
    <div data-v110="resize-chat-wrapper" onPointerDown={() => props.onStart()}>
      <Separator
        axis="x"
        label={props.label}
        data-v110="resize-chat"
        size={chat.width ?? CHAT_MIN_WIDTH}
        min={CHAT_MIN_WIDTH}
        max={max()}
        onResize={props.onResize}
      />
    </div>
  )
}
