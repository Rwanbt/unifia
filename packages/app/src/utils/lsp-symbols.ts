/* SPDX-License-Identifier: MIT */

// LSP document symbols flattened for the go-to-symbol palette and the Code
// inspector's outline (ADR-049).

// LSP SymbolKind numeric constants (LSP spec § SymbolKind).
// We only list the kinds we render — unknown kinds fall back to a generic
// dot icon. Numbers come straight from the spec; keep them in sync.
export const SYMBOL_KIND_LABEL: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
}

export type SymbolEntry = {
  id: string
  name: string
  kind: number
  kindLabel: string
  line: number
  /** Zero-based character of the symbol's name, for position-based LSP requests. */
  character: number
  detail?: string
}

type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } }

/**
 * textDocument/documentSymbol answers either the hierarchical DocumentSymbol
 * shape or the flat SymbolInformation one (`location`, no `selectionRange`).
 * typescript-language-server sends the flat one, measured against the real
 * server, so both are read.
 */
export type LspDocumentSymbol = {
  name: string
  kind: number
  range?: LspRange
  selectionRange?: LspRange
  location?: { uri: string; range: LspRange }
  detail?: string
  children?: LspDocumentSymbol[]
}

export const flattenDocumentSymbols = (items: LspDocumentSymbol[], out: SymbolEntry[] = []): SymbolEntry[] => {
  for (const item of items) {
    const start = (item.selectionRange ?? item.location?.range ?? item.range)?.start
    if (!start) continue
    out.push({
      id: `${item.name}-${start.line}-${start.character}`,
      name: item.name,
      kind: item.kind,
      kindLabel: SYMBOL_KIND_LABEL[item.kind] ?? `Kind ${item.kind}`,
      line: start.line,
      character: start.character,
      detail: item.detail,
    })
    if (item.children?.length) flattenDocumentSymbols(item.children, out)
  }
  return out
}
