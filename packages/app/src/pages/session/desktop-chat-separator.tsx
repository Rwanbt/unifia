/* SPDX-License-Identifier: MIT */

import { Show, type Accessor } from "solid-js"
import { Separator } from "../../primitives/separator"

/**
 * Vague 4 P1-5 (ADR-037) — desktop chat separator extracted from
 * `session.tsx`. Renders the resizable horizontal Separator between the
 * session panel and the chat panel when desktop-inspector is wide.
 *
 * Pure visual sub-component; takes only the accessors + handlers it
 * needs. The host (session.tsx) still owns `size`, `layout`, and
 * `language` closures and passes the accessors in.
 */
export interface DesktopChatSeparatorProps {
  desktopInspectorWide: Accessor<boolean>
  size: {
    start: () => void
    touch: () => void
  }
  layout: {
    session: {
      width: Accessor<number>
      resize: (width: number) => void
    }
  }
  language: { t: (key: string) => string }
}

export function DesktopChatSeparator(props: DesktopChatSeparatorProps) {
  return (
    <Show when={props.desktopInspectorWide()}>
      <div onPointerDown={() => props.size.start()}>
        <Separator
          axis="x"
          label={props.language.t("design.split.handle")}
          data-v110="resize-chat"
          size={props.layout.session.width()}
          min={450}
          max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.45}
          onResize={(width: number) => {
            props.size.touch()
            props.layout.session.resize(width)
          }}
        />
      </div>
    </Show>
  )
}
