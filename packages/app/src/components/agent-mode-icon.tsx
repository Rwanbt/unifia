/* SPDX-License-Identifier: MIT */

import { Match, Switch, createMemo, type JSX } from "solid-js"
import { agentModeIconName } from "./agent-mode"

/**
 * The six v16 mode glyphs, ported verbatim from the maquette's
 * `unifia-v16-agent-modes` module (24x24 viewBox). Styling mirrors the
 * reference CSS: 16px, `fill:none`, `stroke:currentColor`, width 1.8,
 * round caps and joins.
 */
export function AgentModeIcon(props: { name?: string; class?: string }): JSX.Element {
  const mode = createMemo(() => agentModeIconName(props.name))
  return (
    <svg
      class={props.class ?? "size-4 shrink-0"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      data-component="agent-mode-icon"
      data-mode={mode()}
    >
      <Switch>
        <Match when={mode() === "plan"}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
        </Match>
        <Match when={mode() === "debate"}>
          <path d="M4 5h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-3 2.5V14H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="M15 8h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v2.5L16 17h-2.5" />
        </Match>
        <Match when={mode() === "build"}>
          <path d="M14 4.5 19.5 10l-2.3 2.3-2.2-2.2-6.8 6.8a2 2 0 0 1-2.8 0l-.2-.2a2 2 0 0 1 0-2.8l6.8-6.8L9.8 4.8 12.1 2.5 14 4.5Z" />
        </Match>
        <Match when={mode() === "team"}>
          <circle cx="8" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M2.5 19c.7-3.4 2.7-5 5.5-5s4.8 1.6 5.5 5" />
          <path d="M14 15c.8-.8 1.8-1.2 3.1-1.2 2.3 0 3.8 1.3 4.4 3.9" />
          <path d="M11 10.5 14.5 11" />
        </Match>
        <Match when={mode() === "auto"}>
          <path d="M20 7h-5V2" />
          <path d="M20 7a8 8 0 1 0 1 8" />
          <path d="m11 8-2 4h3l-1 4 4-6h-3l1-2" />
        </Match>
        <Match when={true}>
          <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        </Match>
      </Switch>
    </svg>
  )
}