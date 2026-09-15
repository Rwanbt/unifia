/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-health.ts — issue #100 (v65 health chip)
//
// The mockup derives its header chip from overdue tasks and unresolved
// failures (`.work65-health` — "On track" / "At risk" / "Off track"). The
// runtime projection only exposes run statuses, task statuses and gate
// verdicts, so the mapping below stays strictly on those facts and invents
// no signal the server does not have:
//
//   off  — a run failed (the runtime's unresolved-failure analog)
//   risk — a task is blocked, or a gate awaits a human verdict
//   ok   — otherwise, including the empty state (the mockup computes the
//          same "On track" for a task list with nothing wrong in it)
//
// Pure and unit-tested so the classification has one owner.
// =============================================================================

export type WorkHealth = "ok" | "risk" | "off"

export interface WorkHealthInput {
  readonly runStatuses: readonly string[]
  readonly taskStatuses: readonly string[]
  readonly gateVerdicts: readonly string[]
}

export const WORK_HEALTH_I18N_KEY: Record<WorkHealth, string> = {
  ok: "workbench.work.health.onTrack",
  risk: "workbench.work.health.atRisk",
  off: "workbench.work.health.offTrack",
}

const FAILED_RUN_STATUS = "failed"
const BLOCKED_TASK_STATUS = "blocked"
const CHANGES_REQUESTED_VERDICT = "CHANGES_REQUESTED"

export function workHealth(input: WorkHealthInput): WorkHealth {
  if (input.runStatuses.some((status) => status === FAILED_RUN_STATUS)) return "off"
  if (
    input.taskStatuses.some((status) => status === BLOCKED_TASK_STATUS) ||
    input.gateVerdicts.some((verdict) => verdict === CHANGES_REQUESTED_VERDICT)
  ) {
    return "risk"
  }
  return "ok"
}
