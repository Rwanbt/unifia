/* SPDX-License-Identifier: MIT */

import { createMemo, For, Show, type JSX } from "solid-js"
import { Tooltip } from "@unifia/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useLspDiagnostics } from "@/context/lsp-diagnostics"

// Maquette v110 `.terminal-head` / `.v57-terminal-tools`. Only Terminal,
// Problems (#680), Clear, Close, New, Rename and Kill have a backing
// feature; the rest are shown disabled with a "coming soon" tooltip (owner
// decision 2026-09-22) so the chrome matches the reference without any
// control pretending to work.

// aria-disabled rather than disabled: a disabled button swallows pointer
// events, so its "coming soon" tooltip would never open.
const ComingSoon = (props: { label: string; children?: JSX.Element }) => {
  const language = useLanguage()
  return (
    <Tooltip placement="top" value={language.t("terminal.panel.unavailable")}>
      <button type="button" aria-disabled="true">
        {props.label}
        {props.children}
      </button>
    </Tooltip>
  )
}

export type TerminalPanelView = "terminal" | "problems"

export function TerminalPanelHead(props: {
  view: TerminalPanelView
  onView: (view: TerminalPanelView) => void
  onClear: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const diagnostics = useLspDiagnostics()
  const problems = createMemo(() =>
    diagnostics.files().reduce((total, file) => total + diagnostics.errors(file) + diagnostics.warnings(file), 0),
  )
  const soon = ["terminal.panel.output", "terminal.panel.tests", "terminal.panel.debug", "terminal.panel.ports"] as const

  return (
    <div data-v110="terminal-head">
      <div data-v110="terminal-bottom-tabs" role="tablist" aria-label={language.t("terminal.title")}>
        <For each={["terminal", "problems"] as const}>
          {(view) => (
            <button
              type="button"
              role="tab"
              aria-selected={props.view === view}
              data-active={props.view === view ? "true" : undefined}
              data-terminal-view={view}
              onClick={() => {
                // Refetch on open: the store only refreshes on lsp.updated events.
                if (view === "problems") void diagnostics.refresh()
                props.onView(view)
              }}
            >
              {language.t(view === "terminal" ? "terminal.title" : "terminal.panel.problems")}
              <Show when={view === "problems" && problems() > 0}>
                <span data-v110="terminal-tab-count">{problems()}</span>
              </Show>
            </button>
          )}
        </For>
        <For each={soon}>{(key) => <ComingSoon label={language.t(key)} />}</For>
      </div>
      <div class="flex-1" />
      <div data-v110="terminal-head-actions">
        <Tooltip placement="top" value={language.t("terminal.panel.unavailable")}>
          <button type="button" aria-disabled="true" aria-label={language.t("terminal.panel.more")}>
            •••
          </button>
        </Tooltip>
        <Tooltip placement="top" value={language.t("terminal.clear")}>
          <button type="button" onClick={() => props.onClear()} aria-label={language.t("terminal.clear")}>
            ⌫
          </button>
        </Tooltip>
        <Tooltip placement="top" value={language.t("terminal.close")}>
          <button type="button" onClick={() => props.onClose()} aria-label={language.t("terminal.close")}>
            ×
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export function TerminalPanelTools(props: { onNew: () => void; onRename: () => void; onKill: () => void }) {
  const language = useLanguage()
  return (
    <div data-v110="terminal-tools">
      <button type="button" onClick={() => props.onNew()}>
        ＋ {language.t("terminal.tools.new")}
      </button>
      <ComingSoon label={language.t("terminal.tools.split")} />
      <button type="button" onClick={() => props.onRename()}>
        {language.t("terminal.tools.rename")}
      </button>
      <ComingSoon label={language.t("terminal.tools.agent")} />
      <button type="button" onClick={() => props.onKill()}>
        {language.t("terminal.tools.kill")}
      </button>
    </div>
  )
}
