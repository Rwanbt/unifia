/* SPDX-License-Identifier: MIT */

import { parseSpec, resolveEffectiveCapabilities, type Spec } from "@unifia/spec-runtime"

export type DesignSpecSource = { kind: "inline"; value: string } | { kind: "file"; path: string; value: string }
export type DesignSpecDiagnostic = { severity: "error"; message: string; line: number; column: number }
export type DesignSpecPanelState = {
  source: DesignSpecSource
  spec?: Spec
  diagnostics: readonly DesignSpecDiagnostic[]
  capabilities: { granted: readonly string[]; denied: readonly string[] }
}

function location(source: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, source.length))
  const prefix = source.slice(0, bounded)
  const lines = prefix.split("\n")
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function syntaxLocation(source: string, message: string): { line: number; column: number } {
  const lineAndColumn = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  if (lineAndColumn) return { line: Number(lineAndColumn[1]), column: Number(lineAndColumn[2]) }
  const position = message.match(/position\s+(\d+)/i)?.[1]
  return location(source, position ? Number(position) : source.length)
}

/** Parses one untrusted design spec into a renderable panel state. */
export function createDesignSpecPanelState(source: DesignSpecSource): DesignSpecPanelState {
  try {
    const spec = parseSpec(source.value)
    const capabilities = resolveEffectiveCapabilities(spec, [])
    return { source, spec, diagnostics: [], capabilities }
  } catch (error) {
    const message = error instanceof Error ? error.message : "spec validation failed"
    const position = message.includes("valid JSON") ? syntaxLocation(source.value, message) : location(source.value, 0)
    return { source, diagnostics: [{ severity: "error", message, ...position }], capabilities: { granted: [], denied: [] } }
  }
}
