/* SPDX-License-Identifier: MIT */

// A2-02 v110 inspector frame (Wave 0.5). Frame only, never content.
// WHY frame-only: COMPONENT-MAP 1 gives the shell ONE structural inspector
// authority (frame plus tabs), modes own content (A3 and later). The file
// explorer stays the single instance inside the session inspector content
// (data-v110 inspector-content): this file owns structure, never content.
// Tabs Explorer plus Inspector plus Execution mirror INTERACTIONS.md. Graph
// Memory stays a Memory sub-view, never a global tab. Sizes come from A1
// vars (v110-inspector). Open state stays owned by callers and persisted in
// context/layout (layout.v6): the frame is controlled, stores nothing.
// Not mounted yet: A3 branches mode content onto it. Mounting now would
// render a second inspector next to the session panel (P1-2).

import { For, Show, type JSX } from "solid-js"

export const TABS = ["explorer", "inspector", "execution"] as const
export type Tab = (typeof TABS)[number]

export function normalizeTab(value: string | undefined): Tab {
  if (value === "inspector") return "inspector"
  if (value === "execution") return "execution"
  return "explorer"
}

type Props = {
  tab: Tab
  onTab: (tab: Tab) => void
  open: boolean
  onToggle: () => void
  label: string
  /** The tab button's own label. */
  title: (tab: Tab) => string
  /** The head's title: "Prism EQ · Explorer", "Work · Inspector", "Exécution". */
  heading: string
  /** Extra head content after the title (the Execution context and count). */
  headExtra?: JSX.Element
  children: JSX.Element
}

// The maquette's tab glyphs (.v44-inspector-tab svg, 24x24 strokes).
const TAB_ICON: Record<Tab, () => JSX.Element> = {
  explorer: () => <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  inspector: () => (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="10" cy="18" r="1" />
    </>
  ),
  execution: () => (
    <>
      <path d="M5 6h14M5 12h8M5 18h14" />
      <circle cx="17" cy="12" r="2" />
    </>
  ),
}

export function InspectorFrame(props: Props): JSX.Element {
  const current = () => normalizeTab(props.tab)
  return (
    <aside
      data-v110="inspector-frame"
      data-component="v110-inspector-frame"
      data-parity="shell.inspector"
      role="complementary"
      aria-label={props.label}
      style={{ width: "var(--v110-inspector, 300px)" }}
    >
      <div data-v110="inspector-head" data-tab={current()}>
        <span data-v110="inspector-title">{props.heading}</span>
        <Show when={props.headExtra}>{props.headExtra}</Show>
        <button
          type="button"
          aria-expanded={props.open}
          aria-controls="v110-inspector-panel"
          data-action="inspector-toggle"
          onClick={props.onToggle}
        >
          {props.open ? "\u2013" : "+"}
        </button>
      </div>
      <div role="tablist" aria-label={props.label} data-v110="inspector-tabs">
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={current() === tab}
              data-v110-tab={tab}
              onClick={() => props.onTab(tab)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {TAB_ICON[tab]()}
              </svg>
              <span>{props.title(tab)}</span>
            </button>
          )}
        </For>
      </div>
      <div id="v110-inspector-panel" role="tabpanel" hidden={!props.open}>
        {props.children}
      </div>
    </aside>
  )
}
