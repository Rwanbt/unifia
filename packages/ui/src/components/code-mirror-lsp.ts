// FORK: LSP extensions for CodeMirror 6 (Phase 2 — ADR-0005 roadmap).
// Wires diagnostics, hover tooltips and go-to-definition into the editor
// without coupling packages/ui to the SDK or app context.  The parent
// (file-tabs.tsx) owns the API calls and passes them in via LspCallbacks;
// this module only deals with CM internals.
import { forEachDiagnostic, linter } from "@codemirror/lint"
import type { Diagnostic as CMDiagnostic } from "@codemirror/lint"
import { GutterMarker, gutter, hoverTooltip, keymap } from "@codemirror/view"
import { autocompletion } from "@codemirror/autocomplete"
import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete"
import type { Extension, Text } from "@codemirror/state"
import { RangeSet } from "@codemirror/state"

// ─── Public types (consumed by code-mirror.tsx props) ────────────────────────

export interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export interface LspLocation {
  uri: string
  range: LspRange
}

export interface LspDiagnosticEntry {
  range: LspRange
  /** 1=Error 2=Warning 3=Information 4=Hint */
  severity?: number
  message: string
  source?: string
  code?: string | number
}

export interface LspHoverResult {
  contents?: unknown
  range?: LspRange
}

/** Callbacks injected by the parent; each returns a Promise so the CM
 *  extensions can stay async without coupling to a specific HTTP client. */
export interface LspCallbacks {
  getDiagnostics(file: string): Promise<LspDiagnosticEntry[]>
  hover(file: string, line: number, character: number): Promise<LspHoverResult | null>
  definition(file: string, line: number, character: number): Promise<LspLocation[]>
  references(file: string, line: number, character: number): Promise<LspLocation[]>
  complete(file: string, line: number, character: number, triggerChar?: string): Promise<LspCompletionItem[]>
  /** Called when the user presses F2; parent shows a rename dialog. */
  prepareRename?(word: string, line: number, character: number): void
  /** Called when the user presses Ctrl+.; parent fetches and shows code actions. */
  triggerCodeAction?(line: number, character: number, endLine: number, endCharacter: number): void
}

export interface LspCompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: unknown
  insertText?: string
  sortText?: string
  filterText?: string
}

export interface LspTextEdit {
  range: LspRange
  newText: string
}

export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
}

export interface LspCommand {
  command: string
  title: string
  arguments?: unknown[]
}

export interface LspCodeAction {
  title: string
  kind?: string
  isPreferred?: boolean
  edit?: LspWorkspaceEdit
  command?: LspCommand
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a zero-based LSP position to a CM doc offset. */
function lspPosToOffset(doc: Text, line: number, character: number): number {
  // CM lines are 1-indexed; clamp to avoid out-of-range panics.
  const l = Math.min(line + 1, doc.lines)
  const lineObj = doc.line(l)
  return Math.min(lineObj.from + character, lineObj.to)
}

function lspSeverityToCM(severity?: number): CMDiagnostic["severity"] {
  if (severity === 1) return "error"
  if (severity === 2) return "warning"
  return "info"
}

/** Extract plain text from a hover result's `contents` field.
 *  The LSP protocol allows: string | MarkupContent | MarkedString[]. */
function extractHoverText(contents: unknown): string {
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) {
    return (contents as unknown[])
      .map((c) => (typeof c === "string" ? c : (c as { value?: string }).value ?? ""))
      .filter(Boolean)
      .join("\n\n")
  }
  if (contents && typeof contents === "object") {
    return (contents as { value?: string }).value ?? ""
  }
  return ""
}

/** Convert a `file://` URI to a local path (Windows-aware). */
function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri
  // file:///C:/foo → C:/foo  |  file:///home/... → /home/...
  return decodeURIComponent(uri.slice(7).replace(/^\/([A-Z]:)/, "$1"))
}

// LSP CompletionItem.kind (1-25) → CM6 completion type string
function lspKindToType(kind?: number): Completion["type"] {
  if (!kind) return "text"
  if (kind === 2 || kind === 3) return "function" // Method, Function
  if (kind === 4) return "function" // Constructor
  if (kind === 5 || kind === 6) return "variable" // Field, Variable
  if (kind === 7 || kind === 8) return "class" // Class, Interface
  if (kind === 9) return "namespace" // Module
  if (kind === 10) return "property" // Property
  if (kind === 12) return "keyword" // Keyword
  if (kind === 14) return "keyword" // Keyword (Snippet)
  if (kind === 15) return "text" // Color
  if (kind === 17) return "variable" // EnumMember
  if (kind === 21) return "variable" // Constant
  if (kind === 22 || kind === 23) return "class" // Struct, Event
  return "text"
}

function buildLspCompletionSource(path: string, callbacks: LspCallbacks) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // Only trigger on explicit Ctrl+Space or after trigger chars — avoid every keystroke
    const word = context.matchBefore(/\w*/)
    if (!context.explicit && (!word || word.from === word.to)) return null

    const pos = context.pos
    const line = context.state.doc.lineAt(pos)
    const lspLine = line.number - 1
    const lspChar = pos - line.from

    let items: LspCompletionItem[]
    try {
      items = await callbacks.complete(path, lspLine, lspChar)
    } catch {
      return null
    }

    if (!items.length) return null

    return {
      from: word?.from ?? pos,
      options: items.map((item): Completion => ({
        label: item.label,
        type: lspKindToType(item.kind),
        detail: item.detail,
        info: item.documentation ? extractHoverText(item.documentation) : undefined,
        apply: item.insertText ?? item.label,
        boost: item.sortText ? undefined : 0,
      })),
      validFor: /^\w*$/,
    }
  }
}

// ─── Extension builder ───────────────────────────────────────────────────────

/** One v110 diagnostic marker: severity token + the hover message. */
export type V110DiagnosticMarker = { line: number; severity: "error" | "warning" | "info"; message: string }

const severityRank = { error: 3, warning: 2, info: 1 } as const

function v110Severity(severity: CMDiagnostic["severity"]): V110DiagnosticMarker["severity"] {
  if (severity === "error") return "error"
  if (severity === "warning") return "warning"
  return "info"
}

/**
 * Maps CM diagnostics onto v110 gutter markers. One marker per line, the
 * highest severity wins, and every message on the line is kept for the
 * hover title. `lineAt` is injected so the mapping stays pure.
 */
export function collectDiagnosticMarkers(
  diagnostics: readonly CMDiagnostic[],
  lineAt: (offset: number) => number,
): V110DiagnosticMarker[] {
  const byLine = new Map<number, V110DiagnosticMarker>()
  for (const diagnostic of diagnostics) {
    const line = lineAt(diagnostic.from)
    const severity = v110Severity(diagnostic.severity)
    const existing = byLine.get(line)
    if (!existing) {
      byLine.set(line, { line, severity, message: diagnostic.message })
      continue
    }
    const winner = severityRank[severity] > severityRank[existing.severity] ? severity : existing.severity
    byLine.set(line, { line, severity: winner, message: `${existing.message}\n${diagnostic.message}` })
  }
  return [...byLine.values()].sort((left, right) => left.line - right.line)
}

/** Gutter marker carrying the v110 contract (`data-component`/`data-severity`). */
export class V110DiagnosticGutterMarker extends GutterMarker {
  constructor(readonly marker: V110DiagnosticMarker) {
    super()
  }

  elementClass = "cm-v110-diagnostic"

  toDOM(): Node {
    const dom = document.createElement("div")
    dom.setAttribute("data-component", "diagnostic-marker")
    dom.setAttribute("data-severity", this.marker.severity)
    dom.setAttribute("title", this.marker.message)
    return dom
  }
}

/**
 * LSP diagnostics gutter using the v110 marker contract instead of CM's own
 * lint gutter, so the theme rule `[data-component="diagnostic-marker"]`
 * styles real server diagnostics. Squiggles and the lint tooltip stay on the
 * linter extension.
 */
export function v110DiagnosticGutter(): Extension {
  return gutter({
    class: "cm-v110-diagnostic-gutter",
    markers: (view) => {
      const diagnostics: CMDiagnostic[] = []
      forEachDiagnostic(view.state, (diagnostic, from) => {
        // `from` is the clamp-adjusted offset CM reports for the diagnostic.
        diagnostics.push({ ...diagnostic, from })
      })
      const lines = collectDiagnosticMarkers(diagnostics, (offset) => view.state.doc.lineAt(offset).number)
      // Gutter markers are a range set anchored at each line start.
      return RangeSet.of(
        lines.map((marker) => {
          const from = view.state.doc.line(marker.line).from
          return { from, to: from, value: new V110DiagnosticGutterMarker(marker) as GutterMarker }
        }),
      )
    },
  })
}

/**
 * Build CM6 extensions for LSP features:
 *  - Diagnostics gutter + squiggles (750 ms debounce)
 *  - Hover tooltip (300 ms delay)
 *  - F12 → go-to-definition (calls `onNavigate` when found)
 *  - Shift+F12 → find all references (calls `onReferences` when found)
 *  - Autocomplete (Ctrl+Space / typing triggers via LSP textDocument/completion)
 */
export function buildLspExtensions(
  path: string,
  callbacks: LspCallbacks,
  onNavigate?: (file: string, line: number, character: number) => void,
  onReferences?: (refs: LspLocation[]) => void,
): Extension[] {
  const extensions: Extension[] = []

  // ── Autocomplete (LSP textDocument/completion) ────────────────────────────
  extensions.push(
    autocompletion({
      override: [buildLspCompletionSource(path, callbacks)],
      activateOnTyping: false,
    }),
  )

  // ── Diagnostics ──────────────────────────────────────────────────────────
  extensions.push(
    v110DiagnosticGutter(),
    linter(
      async (view) => {
        let diags: LspDiagnosticEntry[]
        try {
          diags = await callbacks.getDiagnostics(path)
        } catch {
          return []
        }
        return diags.flatMap((d): CMDiagnostic[] => {
          try {
            const from = lspPosToOffset(view.state.doc, d.range.start.line, d.range.start.character)
            const to = lspPosToOffset(view.state.doc, d.range.end.line, d.range.end.character)
            return [
              {
                from,
                // CM requires to >= from even for zero-width positions.
                to: Math.max(to, from + 1),
                severity: lspSeverityToCM(d.severity),
                message: d.source ? `[${d.source}] ${d.message}` : d.message,
              },
            ]
          } catch {
            return []
          }
        })
      },
      { delay: 750 },
    ),
  )

  // ── Hover tooltip ─────────────────────────────────────────────────────────
  extensions.push(
    hoverTooltip(
      async (view, pos) => {
        const line = view.state.doc.lineAt(pos)
        const lspLine = line.number - 1 // CM 1-indexed → LSP 0-indexed
        const lspChar = pos - line.from
        let result: LspHoverResult | null
        try {
          result = await callbacks.hover(path, lspLine, lspChar)
        } catch {
          return null
        }
        if (!result?.contents) return null
        const text = extractHoverText(result.contents)
        if (!text) return null
        return {
          pos,
          create() {
            const dom = document.createElement("div")
            dom.className = "cm-lsp-tooltip"
            // Simple pre-formatted display; markdown rendering is deferred.
            const pre = document.createElement("pre")
            pre.textContent = text
            dom.appendChild(pre)
            return { dom }
          },
        }
      },
      { hideOnChange: true, hoverTime: 300 },
    ),
  )

  // ── Go-to-definition (F12) ───────────────────────────────────────────────
  if (onNavigate) {
    extensions.push(
      keymap.of([
        {
          key: "F12",
          run: (view) => {
            const pos = view.state.selection.main.head
            const line = view.state.doc.lineAt(pos)
            const lspLine = line.number - 1
            const lspChar = pos - line.from
            void callbacks
              .definition(path, lspLine, lspChar)
              .then((locs) => {
                if (locs.length === 0) return
                const loc = locs[0]!
                onNavigate(uriToPath(loc.uri), loc.range.start.line, loc.range.start.character)
              })
              .catch(() => {})
            return true
          },
        },
      ]),
    )
  }

  // ── Rename symbol (F2) ───────────────────────────────────────────────────
  if (callbacks.prepareRename) {
    const onPrepareRename = callbacks.prepareRename
    extensions.push(
      keymap.of([
        {
          key: "F2",
          run: (view) => {
            const pos = view.state.selection.main.head
            const line = view.state.doc.lineAt(pos)
            const lspLine = line.number - 1
            const lspChar = pos - line.from
            // Extract the word under cursor to pre-fill the rename input
            const wordMatch = view.state.wordAt(pos)
            const word = wordMatch ? view.state.sliceDoc(wordMatch.from, wordMatch.to) : ""
            onPrepareRename(word, lspLine, lspChar)
            return true
          },
        },
      ]),
    )
  }

  // ── Code actions (Ctrl+.) ────────────────────────────────────────────────
  if (callbacks.triggerCodeAction) {
    const onTrigger = callbacks.triggerCodeAction
    extensions.push(
      keymap.of([
        {
          key: "Mod-.",
          run: (view) => {
            const sel = view.state.selection.main
            const startLine = view.state.doc.lineAt(sel.from)
            const endLine = view.state.doc.lineAt(sel.to)
            onTrigger(
              startLine.number - 1,
              sel.from - startLine.from,
              endLine.number - 1,
              sel.to - endLine.from,
            )
            return true
          },
        },
      ]),
    )
  }

  // ── Find all references (Shift+F12) ──────────────────────────────────────
  if (onReferences) {
    extensions.push(
      keymap.of([
        {
          key: "Shift-F12",
          run: (view) => {
            const pos = view.state.selection.main.head
            const line = view.state.doc.lineAt(pos)
            const lspLine = line.number - 1
            const lspChar = pos - line.from
            void callbacks
              .references(path, lspLine, lspChar)
              .then((refs) => {
                onReferences(refs)
              })
              .catch(() => {})
            return true
          },
        },
      ]),
    )
  }

  return extensions
}
