/* SPDX-License-Identifier: MIT */
// Human-driven task status changes (CR06, issue #86).
//
// The engine owns assigned/running/completed: a person moving a card there would
// forge worker progress and skip the review gates. A person may only park a task
// (blocked), release it (pending) or abandon it (cancelled).

import type { TeamRunRow, TeamTaskRow } from "./team-store"

export type TaskStatus = TeamTaskRow["status"]

export const HUMAN_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ["blocked", "cancelled"],
  assigned: ["blocked", "cancelled"],
  running: ["blocked", "cancelled"],
  blocked: ["pending", "cancelled"],
  completed: [],
  cancelled: [],
}

const SETTLED_TASK_STATUSES: readonly TaskStatus[] = ["completed", "cancelled"]
const CLOSED_RUN_STATUSES: readonly TeamRunRow["status"][] = ["completed", "failed", "aborted"]

export type TaskTransitionRefusal =
  | { readonly reason: "stale"; readonly message: string }
  | { readonly reason: "not_allowed"; readonly message: string }
  | { readonly reason: "run_closed"; readonly message: string }
  | { readonly reason: "live_dependents"; readonly message: string; readonly dependents: readonly string[] }

export type TaskTransitionPlan = { readonly ok: true } | ({ readonly ok: false } & TaskTransitionRefusal)

export function planHumanTaskTransition(input: {
  readonly task: TeamTaskRow
  readonly expectedFrom: TaskStatus
  readonly to: TaskStatus
  readonly runStatus: TeamRunRow["status"]
  readonly runTasks: readonly TeamTaskRow[]
}): TaskTransitionPlan {
  const { task, expectedFrom, to, runStatus, runTasks } = input
  if (task.status !== expectedFrom) {
    return { ok: false, reason: "stale", message: `task ${task.taskId} is ${task.status}, not ${expectedFrom}` }
  }
  if (CLOSED_RUN_STATUSES.includes(runStatus)) {
    return { ok: false, reason: "run_closed", message: `run ${task.runId} is ${runStatus}` }
  }
  if (!HUMAN_TASK_TRANSITIONS[task.status].includes(to)) {
    return { ok: false, reason: "not_allowed", message: `a person cannot move a task from ${task.status} to ${to}` }
  }
  if (to === "cancelled") {
    const dependents = runTasks
      .filter((other) => other.dependsOn.includes(task.taskId) && !SETTLED_TASK_STATUSES.includes(other.status))
      .map((other) => other.taskId)
    if (dependents.length > 0) {
      return {
        ok: false,
        reason: "live_dependents",
        message: `tasks ${dependents.join(", ")} still depend on ${task.taskId}`,
        dependents,
      }
    }
  }
  return { ok: true }
}
