/* SPDX-License-Identifier: MIT */

// Pure mappings behind the Observability data views (ADR-050): which dot and
// pill an event gets, and how durations, costs and day buckets are shown.

export type EventKind = "llm" | "tool" | "agent" | "error"
export type StatusTone = "ok" | "warn" | "err"

const FAILED = new Set(["failed", "error", "aborted", "cancelled", "timeout"])
const RUNNING = new Set(["started", "pending", "running", "retry", "queued"])

export function statusTone(status: string, derivedStatus?: string): StatusTone {
  if (derivedStatus === "orphaned" || FAILED.has(status)) return "err"
  if (RUNNING.has(status)) return "warn"
  return "ok"
}

/** The event's family from its type prefix (`llm.call.finished` → llm); a failure shows as error. */
export function eventKind(type: string, status: string): EventKind {
  if (FAILED.has(status)) return "error"
  const family = type.split(".")[0]
  if (family === "llm") return "llm"
  if (family === "tool") return "tool"
  return "agent"
}

export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export function formatCost(nanoUsd: number | undefined, digits = 4): string | undefined {
  if (nanoUsd === undefined) return undefined
  return `$${(nanoUsd / 1_000_000_000).toFixed(digits)}`
}

/** "842 ms · $0.0124", "118 ms · —", or "—" when neither is known. */
export function formatDurationCost(durationMs: number | undefined, costNanoUsd: number | undefined): string {
  const duration = formatDuration(durationMs)
  const cost = formatCost(costNanoUsd)
  if (!duration && !cost) return "—"
  return `${duration ?? "—"} · ${cost ?? "—"}`
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

/**
 * The local midnights opening each of the last `days` days, oldest first,
 * followed by the next midnight: day i spans [bounds[i], bounds[i + 1]).
 */
export function dayBounds(now: Date, days: number): number[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return Array.from({ length: days + 1 }, (_, index) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + index).getTime(),
  )
}

/**
 * Per-day amounts from cumulative totals: `since[i]` is the total of every
 * event at or after bounds[i], so a day is the difference of two neighbours.
 * The last entry (after the next midnight) is normally 0.
 */
export function dailyFromCumulative(since: number[]): number[] {
  return since.slice(0, -1).map((total, index) => Math.max(0, total - since[index + 1]))
}
