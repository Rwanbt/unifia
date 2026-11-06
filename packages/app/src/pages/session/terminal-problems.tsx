/* SPDX-License-Identifier: MIT */

// Terminal "Problems" view (#680). The producer is the LSP diagnostics store
// that already feeds the tab's count; this view lists the same entries, errors
// first, and opens the file at the reported line on click.

import { createMemo, For, Show, type JSX } from "solid-js"
import { getFilename } from "@unifia/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLspDiagnostics } from "@/context/lsp-diagnostics"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { problemRows, type ProblemRow } from "@/pages/session/terminal-problem-rows"

export function TerminalProblems(): JSX.Element {
  const language = useLanguage()
  const diagnostics = useLspDiagnostics()
  const sdk = useSDK()
  const file = useFile()
  const { tabs } = useSessionLayout()

  const rows = createMemo(() =>
    problemRows(Object.fromEntries(diagnostics.files().map((path) => [path, diagnostics.for(path)])), sdk.directory),
  )
  const open = (row: ProblemRow) => {
    const tab = file.tab(row.path)
    tabs().open(tab)
    void file.load(row.path)
    tabs().setActive(tab)
    file.setSelectedLines(row.path, { start: row.line, end: row.line })
  }

  return (
    <div data-v110="terminal-problems" role="tabpanel" class="flex-1 min-h-0 overflow-auto">
      <Show when={rows().length > 0} fallback={<p data-v110="terminal-problems-empty">{language.t("terminal.problems.empty")}</p>}>
        <ul>
          <For each={rows()}>
            {(row) => (
              <li>
                <button type="button" data-terminal-problem={row.severity} onClick={() => open(row)}>
                  <b>
                    {getFilename(row.path)}:{row.line}:{row.column}
                  </b>
                  <span>{row.message}</span>
                  <Show when={row.source}>
                    <small>{row.source}</small>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
