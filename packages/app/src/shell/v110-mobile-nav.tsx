/* SPDX-License-Identifier: MIT */

// A2-03 v110 phone bottom bar. Props-driven: the rail owns the mode
// registry and the grant gate (mode.modes), so this bar renders the modes
// it is given plus the shared Browser/Memory destinations, never a second
// registry. "More" opens the reference's quick-action strip (#mobileSheet):
// theme, compute, account, review and settings.
// Phone only (ADR-053): hidden by default, shown by v110-shell.css. Safe
// areas use env() so the iOS notch never covers a tab.

import { createSignal, For, onCleanup, onMount, type Accessor, type JSX } from "solid-js"
import { Icon } from "@unifia/ui/icon"
import type { ShellMode } from "@unifia/workbench-shell/modes"
import type { WorkspaceDestination } from "@/context/mode-directory"
import { modeIcon, PILL_DESTINATIONS } from "@/shell/v110-destinations"

export type MobileAction = "theme" | "compute" | "account" | "review" | "settings"

// The reference's glyphs for its quick actions (#mobileSheet).
const ACTIONS = [
  { id: "theme", glyph: "◐", labelKey: "mobile.sheet.theme" },
  { id: "compute", glyph: "▣", labelKey: "mobile.sheet.compute" },
  { id: "account", glyph: "◉", labelKey: "sidebar.account" },
  { id: "review", glyph: "◎", labelKey: "mobile.sheet.review" },
  { id: "settings", glyph: "⚙", labelKey: "sidebar.settings" },
] as const satisfies readonly { id: MobileAction; glyph: string; labelKey: string }[]

type MobileLabel =
  | `mobile.nav.${ShellMode | "more"}`
  | "mobile.sheet.label"
  | (typeof ACTIONS)[number]["labelKey"]
  | (typeof PILL_DESTINATIONS)[number]["labelKey"]
  | "workbench.modes.railLabel"

type Props = {
  modes: Accessor<readonly ShellMode[]>
  active: Accessor<WorkspaceDestination>
  onDestination: (destination: WorkspaceDestination) => void
  onAction: (action: MobileAction) => void
  label: (key: MobileLabel) => string
}

export function MobileNav(props: Props): JSX.Element {
  const [open, setOpen] = createSignal(false)
  let nav: HTMLElement | undefined
  let sheet: HTMLElement | undefined

  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (open() && !nav?.contains(target) && !sheet?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", closeOutside, true)
    document.addEventListener("keydown", closeOnEscape)
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeOutside, true)
      document.removeEventListener("keydown", closeOnEscape)
    })
  })

  const go = (destination: WorkspaceDestination) => {
    setOpen(false)
    props.onDestination(destination)
  }

  // data-mode marks the four shell modes only, as on the rail: Browser and
  // Memory are destinations, not registered modes.
  const tab = (destination: WorkspaceDestination, icon: Parameters<typeof Icon>[0]["name"], label: string, mode?: ShellMode) => (
    <button
      type="button"
      data-mode={mode}
      data-destination={destination}
      data-v110-tab={destination}
      aria-label={label}
      aria-pressed={props.active() === destination}
      onClick={() => go(destination)}
    >
      <Icon name={icon} />
      <span data-slot="mobile-nav-label">{label}</span>
    </button>
  )

  return (
    <>
      <section
        ref={sheet}
        data-v110="mobile-sheet"
        data-open={open()}
        aria-label={props.label("mobile.sheet.label")}
        aria-hidden={!open()}
        inert={!open()}
      >
        <For each={ACTIONS}>
          {(action) => (
            <button
              type="button"
              data-mobile-action={action.id}
              onClick={() => {
                setOpen(false)
                props.onAction(action.id)
              }}
            >
              <span aria-hidden="true">{action.glyph}</span>
              <b>{props.label(action.labelKey)}</b>
            </button>
          )}
        </For>
      </section>
      <nav
        ref={nav}
        data-v110="mobile-nav"
        data-component="v110-mobile-nav"
        aria-label={props.label("workbench.modes.railLabel")}
      >
        <For each={props.modes()}>{(mode) => tab(mode, modeIcon(mode), props.label(`mobile.nav.${mode}`), mode)}</For>
        <For each={PILL_DESTINATIONS}>{(pill) => tab(pill.target, pill.icon, props.label(pill.labelKey))}</For>
        <button
          type="button"
          data-action="mobile-more"
          aria-label={props.label("mobile.sheet.label")}
          aria-expanded={open()}
          aria-pressed={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="more" />
          <span data-slot="mobile-nav-label">{props.label("mobile.nav.more")}</span>
        </button>
      </nav>
    </>
  )
}
