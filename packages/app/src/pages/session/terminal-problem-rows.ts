/* SPDX-License-Identifier: MIT */

// Pure part of the terminal Problems view (#680), kept free of app contexts so
// it can be unit-tested without loading the router.

import { canonical } from "@/context/file/canonical"
import type { Diagnostic } from "@/context/lsp-diagnostics"

// LSP DiagnosticSeverity (spec values), as in context/lsp-diagnostics.
const ERROR = 1
const WARNING = 2

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
  if (diagnostic.severity === ERROR) return "error"
  if (diagnostic.severity === WARNING) return "warning"
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
