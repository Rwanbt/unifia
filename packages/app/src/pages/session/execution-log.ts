/* SPDX-License-Identifier: MIT */

// The inspector's Execution tab renders the session's native observability
// events (llm / tool / agent spans) as the reference's .v96-execution-row
// list. This module owns the mapping: which filter an event answers to, the
// glyph and copy it shows. Started spans are skipped: each call appears once,
// at its terminal event.

export type ExecutionEvent = {
  eventId: string
  type: string
  status: string
  derivedStatus?: "orphaned"
  tsMs: number
  durationMs?: number
  stepIndex?: number
  metadata?: Record<string, unknown>
}

export const EXECUTION_FILTERS = [
  "all",
  "model",
  "context",
  "tools",
  "sources",
  "skills",
  "memory",
  "agents",
  "rules",
  "interaction",
  "usage",
] as const
export type ExecutionFilter = (typeof EXECUTION_FILTERS)[number]

export type ExecutionRow = {
  id: string
  time: string
  glyph: string
  title: string
  summary: string
  meta: string
  status: "success" | "error" | "warning"
  filters: readonly ExecutionFilter[]
}

const SOURCE_TOOLS = new Set(["websearch", "webfetch", "codesearch"])

function toolKind(event: ExecutionEvent): string {
  const kind = event.metadata?.toolKind
  return typeof kind === "string" ? kind : "tool"
}

function toolFilter(kind: string): ExecutionFilter {
  if (kind === "skill") return "skills"
  if (SOURCE_TOOLS.has(kind)) return "sources"
  if (kind.startsWith("memory")) return "memory"
  if (kind === "question") return "interaction"
  return "tools"
}

const TOOL_GLYPH: Record<string, string> = { bash: "›_", edit: "±", write: "±", apply_patch: "±", read: "◈", skill: "✦", websearch: "⊕", webfetch: "⊕" }

function duration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`
}

function status(event: ExecutionEvent): ExecutionRow["status"] {
  if (event.derivedStatus === "orphaned" || event.status === "aborted") return "warning"
  if (event.status === "failed") return "error"
  return "success"
}

function clock(tsMs: number): string {
  const date = new Date(tsMs)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** One reference row per terminal span; undefined for a started span. */
export function executionRow(event: ExecutionEvent, statusLabel: (status: string) => string): ExecutionRow | undefined {
  if (event.status === "started") return undefined
  const family = event.type.split(".")[0]
  const turn = event.stepIndex !== undefined ? ` · tour ${event.stepIndex + 1}` : ""
  const spent = duration(event.durationMs)
  const base = { id: event.eventId, time: clock(event.tsMs), status: status(event) }

  if (family === "llm") {
    const model = typeof event.metadata?.modelId === "string" ? event.metadata.modelId : undefined
    return {
      ...base,
      glyph: "◇",
      title: "llm.call",
      summary: [model, spent].filter(Boolean).join(" · "),
      meta: `model · ${statusLabel(event.status)}${turn}`,
      filters: ["model", "usage"],
    }
  }
  if (family === "tool") {
    const kind = toolKind(event)
    const filter = toolFilter(kind)
    return {
      ...base,
      glyph: TOOL_GLYPH[kind] ?? "⚙",
      title: `tool.${kind}`,
      summary: [kind, spent].filter(Boolean).join(" · "),
      meta: `${filter} · ${statusLabel(event.status)}${turn}`,
      filters: [filter],
    }
  }
  if (family === "agent") {
    return {
      ...base,
      glyph: "✦",
      title: "agent.call",
      summary: spent ?? "",
      meta: `agents · ${statusLabel(event.status)}${turn}`,
      filters: ["agents"],
    }
  }
  return undefined
}

/** Terminal rows, oldest first like the reference, narrowed to one filter. */
export function executionRows(
  events: readonly ExecutionEvent[],
  filter: ExecutionFilter,
  statusLabel: (status: string) => string,
): ExecutionRow[] {
  return [...events]
    .sort((a, b) => a.tsMs - b.tsMs)
    .map((event) => executionRow(event, statusLabel))
    .filter((row): row is ExecutionRow => row !== undefined)
    .filter((row) => filter === "all" || row.filters.includes(filter))
}
