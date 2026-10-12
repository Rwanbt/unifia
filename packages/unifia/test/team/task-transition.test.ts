/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { planHumanTaskTransition, type TaskStatus } from "../../src/team/task-transition"
import type { TeamTaskRow } from "../../src/team/team-store"

function task(taskId: string, status: TaskStatus, dependsOn: string[] = []): TeamTaskRow {
  return { taskId, runId: "run-1", status, dependsOn, scope: {}, createdAt: "t", updatedAt: "t" }
}

function plan(current: TeamTaskRow, to: TaskStatus, others: TeamTaskRow[] = [], runStatus: "running" | "completed" = "running") {
  return planHumanTaskTransition({ task: current, expectedFrom: current.status, to, runStatus, runTasks: [current, ...others] })
}

describe("planHumanTaskTransition", () => {
  test("blocked_to_pending_releases_the_task", () => {
    expect(plan(task("a", "blocked"), "pending")).toEqual({ ok: true })
  })

  test("running_to_blocked_parks_the_task", () => {
    expect(plan(task("a", "running"), "blocked")).toEqual({ ok: true })
  })

  test("a_person_cannot_forge_engine_owned_statuses", () => {
    for (const to of ["assigned", "running", "completed"] as const) {
      const result = plan(task("a", "pending"), to)
      expect(result).toMatchObject({ ok: false, reason: "not_allowed" })
    }
  })

  test("settled_tasks_are_terminal", () => {
    expect(plan(task("a", "completed"), "pending")).toMatchObject({ ok: false, reason: "not_allowed" })
    expect(plan(task("a", "cancelled"), "pending")).toMatchObject({ ok: false, reason: "not_allowed" })
  })

  test("a_stale_expected_status_is_refused", () => {
    const current = task("a", "running")
    const result = planHumanTaskTransition({ task: current, expectedFrom: "pending", to: "blocked", runStatus: "running", runTasks: [current] })
    expect(result).toMatchObject({ ok: false, reason: "stale" })
  })

  test("a_closed_run_refuses_every_change", () => {
    expect(plan(task("a", "blocked"), "pending", [], "completed")).toMatchObject({ ok: false, reason: "run_closed" })
  })

  test("cancel_is_refused_while_a_live_task_depends_on_it", () => {
    const result = plan(task("a", "pending"), "cancelled", [task("b", "pending", ["a"])])
    expect(result).toMatchObject({ ok: false, reason: "live_dependents", dependents: ["b"] })
  })

  test("cancel_is_allowed_once_dependents_are_settled", () => {
    expect(plan(task("a", "pending"), "cancelled", [task("b", "cancelled", ["a"]), task("c", "completed", ["a"])])).toEqual({ ok: true })
  })
})
