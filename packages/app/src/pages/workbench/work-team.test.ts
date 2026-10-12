/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { nextActionableTask, pickActiveRun, taskProgress, type WorkRun } from "./work-team"

// Unit coverage for A5-01's Work-surface decisions: which run is "the" active
// one, and how complete its tasks are. Pure and Solid-free, like team.test.ts.

const run = (runId: string, status: string, updatedAt: string): WorkRun => ({ runId, status, updatedAt })

describe("pickActiveRun — a live run always wins over a finished one", () => {
  test("prefers running over pending over completed", () => {
    const runs = [run("r1", "completed", "2026-01-01"), run("r2", "running", "2026-01-02"), run("r3", "pending", "2026-01-03")]
    expect(pickActiveRun(runs)?.runId).toBe("r2")
  })

  test("among equally-in-flight runs, the most recently updated wins", () => {
    const runs = [run("r1", "running", "2026-01-01"), run("r2", "running", "2026-01-05")]
    expect(pickActiveRun(runs)?.runId).toBe("r2")
  })

  test("falls back to the most recently updated run when nothing is in flight", () => {
    const runs = [run("r1", "completed", "2026-01-01"), run("r2", "failed", "2026-01-03")]
    expect(pickActiveRun(runs)?.runId).toBe("r2")
  })

  test("no runs means no active run", () => {
    expect(pickActiveRun([])).toBeUndefined()
  })
})

describe("taskProgress — an honest completed/total percentage", () => {
  test("counts completed tasks against the total", () => {
    const tasks = [{ taskId: "t1", status: "completed" }, { taskId: "t2", status: "running" }, { taskId: "t3", status: "completed" }]
    expect(taskProgress(tasks)).toEqual({ completed: 2, total: 3, percent: 67 })
  })

  test("an empty task list is 0%, not NaN or a division by zero", () => {
    expect(taskProgress([])).toEqual({ completed: 0, total: 0, percent: 0 })
  })

  test("all tasks completed is 100%", () => {
    const tasks = [{ taskId: "t1", status: "completed" }, { taskId: "t2", status: "completed" }]
    expect(taskProgress(tasks)).toEqual({ completed: 2, total: 2, percent: 100 })
  })
})

describe("nextActionableTask — pending tasks with completed dependencies in an open run", () => {
  const task = (taskId: string, status: string, dependsOn: string[] = []): TeamGraphTask => ({
    taskId,
    status,
    dependsOn,
  })

  test("a task with no dependencies and not yet completed is next", () => {
    const tasks = [task("t1", "completed"), task("t2", "pending")]
    expect(nextActionableTask(tasks, "running")?.taskId).toBe("t2")
  })

  test("a task blocked on a running dependency has no next safe action", () => {
    const tasks = [task("t1", "running"), task("t2", "pending", ["t1"])]
    expect(nextActionableTask(tasks, "running")).toBeUndefined()
  })

  test("once every wave is completed, there is no next task", () => {
    const tasks = [task("t1", "completed"), task("t2", "completed", ["t1"])]
    expect(nextActionableTask(tasks, "running")).toBeUndefined()
  })

  test("no tasks means no next task", () => {
    expect(nextActionableTask([], "running")).toBeUndefined()
  })

  test("completed dependencies make a pending task eligible", () => {
    expect(nextActionableTask([task("a", "completed"), task("b", "pending", ["a"])], "pending")?.taskId).toBe("b")
  })

  test.each(["assigned", "running", "blocked", "cancelled", "unknown"])("%s tasks are not new safe actions", (status) => {
    expect(nextActionableTask([task("a", status), task("b", "pending", ["a"])], "running")).toBeUndefined()
  })

  test("missing dependencies and cycles cannot become safe through layout fallback", () => {
    expect(nextActionableTask([task("a", "pending", ["missing"])], "running")).toBeUndefined()
    expect(nextActionableTask([task("a", "pending", ["b"]), task("b", "pending", ["a"])], "running")).toBeUndefined()
  })

  test.each(["completed", "failed", "aborted", "unknown", ""])("%s runs cannot offer new safe actions", (status) => {
    expect(nextActionableTask([task("a", "pending")], status)).toBeUndefined()
  })
})
