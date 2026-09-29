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
  detail?: string
}

export type LspDocumentSymbol = {
  name: string
  kind: number
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } }
  detail?: string
  children?: LspDocumentSymbol[]
}

export const flattenDocumentSymbols = (items: LspDocumentSymbol[], out: SymbolEntry[] = []): SymbolEntry[] => {
  for (const item of items) {
    out.push({
      id: `${item.name}-${item.selectionRange.start.line}-${item.selectionRange.start.character}`,
      name: item.name,
      kind: item.kind,
      kindLabel: SYMBOL_KIND_LABEL[item.kind] ?? `Kind ${item.kind}`,
      line: item.selectionRange.start.line,
      detail: item.detail,
    })
    if (item.children?.length) flattenDocumentSymbols(item.children, out)
  }
  return out
}
