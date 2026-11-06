/* SPDX-License-Identifier: MIT */

// Terminal "Problems" view (#680). The producer is the LSP diagnostics store
// that already feeds the tab's count; this view lists the same entries, errors
// first, and opens the file at the reported line on click.

import { createMemo, For, Show, type JSX } from "solid-js"
import { getFilename } from "@unifia/util/path"
import { canonical } from "@/context/file/canonical"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { DiagnosticSeverity, useLspDiagnostics, type Diagnostic } from "@/context/lsp-diagnostics"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"

export type ProblemRow = {
  key: string
  /** Project-relative path, as the file tabs use it. */
  path: string
  /** One-based, as editors show it. */
  line: number
  column: number
  severity: "error" | "warning" | "info"
  message: string
  source?: string
}

const severityOf = (diagnostic: Diagnostic): ProblemRow["severity"] => {
  if (diagnostic.severity === DiagnosticSeverity.Error) return "error"
  if (diagnostic.severity === DiagnosticSeverity.Warning) return "warning"
  return "info"
}

const RANK: Record<ProblemRow["severity"], number> = { error: 0, warning: 1, info: 2 }

/** Flattens the per-file diagnostics map, errors first, then by path and position. */
export function problemRows(files: Record<string, readonly Diagnostic[]>, root: string): ProblemRow[] {
  const rows = Object.entries(files).flatMap(([file, diagnostics]) =>
    diagnostics.map((diagnostic, index) => ({
      key: `${file}:${index}`,
      path: canonical(file, root),
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      severity: severityOf(diagnostic),
      message: diagnostic.message,
      source: diagnostic.source,
    })),
  )
  return rows.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column,
  )
}

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
