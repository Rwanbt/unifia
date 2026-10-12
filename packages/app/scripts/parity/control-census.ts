// SPDX-License-Identifier: MIT
import ts from "typescript"

export type ControlCandidate = {
  line: number
  tag: string
  attributes: Record<string, string>
  spreads: string[]
  disposition: "UNREVIEWED"
}

const nativeControls = new Set(["button", "a", "input", "select", "textarea", "form", "summary"])

/** Structural candidates only: handlers and labels do not prove behavior or visibility. */
export function scanControlCandidates(file: string, source: string): ControlCandidate[] {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const diagnostics = (syntax as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics.length > 0) {
    throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, " ")}`)
  }
  const candidates: ControlCandidate[] = []
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(syntax)
      const attributes: Record<string, string> = Object.create(null)
      const spreads: string[] = []
      for (const property of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(property)) spreads.push(property.expression.getText(syntax))
        else attributes[property.name.getText(syntax)] = property.initializer?.getText(syntax) ?? "true"
      }
      // WHY: every custom wrapper and spread remains a candidate until a
      // reviewer proves it cannot introduce an interactive shipped element.
      const custom = !ts.isIdentifier(node.tagName) || tag[0] !== tag[0]?.toLowerCase()
      if (nativeControls.has(tag) || custom || spreads.length > 0 || "role" in attributes || Object.keys(attributes).some((name) => name.startsWith("on"))) {
        candidates.push({
          line: syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1,
          tag,
          attributes,
          spreads,
          disposition: "UNREVIEWED",
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
  return candidates
}
