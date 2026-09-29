/* SPDX-License-Identifier: MIT */

// Matrix row "Diagnostic markers" (#96 slice 1): the LSP diagnostics already
// flow through the linter; this pins the v110 marker contract that the
// previously dormant theme rule targets.

import { describe, expect, test } from "bun:test"
import { V110DiagnosticGutterMarker, collectDiagnosticMarkers } from "@unifia/ui/code-mirror-lsp"

describe("v110 diagnostic markers", () => {
  test("maps diagnostics onto lines with the highest severity winning", () => {
    const markers = collectDiagnosticMarkers(
      [
        { from: 0, to: 1, severity: "warning", message: "warn" },
        { from: 2, to: 3, severity: "error", message: "boom" },
        { from: 4, to: 5, severity: "info", message: "note" },
      ],
      (offset) => (offset < 2 ? 1 : offset < 4 ? 2 : 3),
    )
    expect(markers).toEqual([
      { line: 1, severity: "warning", message: "warn" },
      { line: 2, severity: "error", message: "boom" },
      { line: 3, severity: "info", message: "note" },
    ])
  })

  test("joins every message on a line and keeps the error severity", () => {
    const markers = collectDiagnosticMarkers(
      [
        { from: 0, to: 1, severity: "info", message: "first" },
        { from: 0, to: 1, severity: "error", message: "second" },
        { from: 0, to: 1, severity: "hint", message: "third" },
      ],
      () => 7,
    )
    expect(markers).toEqual([{ line: 7, severity: "error", message: "first\nsecond\nthird" }])
  })

  test("a hint stays a neutral info marker and no diagnostics means no markers", () => {
    expect(collectDiagnosticMarkers([{ from: 0, to: 1, severity: "hint", message: "hint" }], () => 1)).toEqual([
      { line: 1, severity: "info", message: "hint" },
    ])
    expect(collectDiagnosticMarkers([], () => 1)).toEqual([])
  })

  test("the marker DOM carries the v110 contract and the hover message", () => {
    const element = new V110DiagnosticGutterMarker({ line: 2, severity: "error", message: "boom" }).toDOM() as HTMLElement
    expect(element.getAttribute("data-component")).toBe("diagnostic-marker")
    expect(element.getAttribute("data-severity")).toBe("error")
    expect(element.getAttribute("title")).toBe("boom")
  })
})
