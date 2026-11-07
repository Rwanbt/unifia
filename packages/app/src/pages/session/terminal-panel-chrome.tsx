/* SPDX-License-Identifier: MIT */

import { createMemo, For, Show } from "solid-js"
import { Tooltip } from "@unifia/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useLspDiagnostics } from "@/context/lsp-diagnostics"

// Maquette v110 `.terminal-head` / `.v57-terminal-tools`. Only controls with a
// backing feature are rendered: Terminal, Problems (#680), Clear, Close, New,
// Rename and Kill. The disabled "coming soon" placeholders (Output, Tests,
// Debug, Ports, •••, Split, Agent terminal) were removed at the owner's
// request (2026-11-07): a control that does nothing is worse than none.

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
      </div>
      <div class="flex-1" />
      <div data-v110="terminal-head-actions">
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
      <button type="button" onClick={() => props.onRename()}>
        {language.t("terminal.tools.rename")}
      </button>
      <button type="button" onClick={() => props.onKill()}>
        {language.t("terminal.tools.kill")}
      </button>
    </div>
  )
}
