/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { allowedMoves, groupByColumn, KANBAN_COLUMNS } from "./work-board"

const task = (taskId: string, status: string, dependsOn: string[] = []): TeamGraphTask => ({
  taskId,
  status,
  dependsOn,
})

describe("groupByColumn — real tasks sorted into the real status enum", () => {
  test("every real status has its own column, in the server's own order", () => {
    expect(KANBAN_COLUMNS).toEqual(["pending", "assigned", "running", "blocked", "completed", "cancelled"])
  })

  test("groups one task per matching column", () => {
    const tasks = [
      task("t1", "pending"),
      task("t2", "assigned"),
      task("t3", "running"),
      task("t4", "blocked"),
      task("t5", "completed"),
      task("t6", "cancelled"),
    ]
    const grouping = groupByColumn(tasks)
    for (const column of KANBAN_COLUMNS) {
      expect(grouping[column].map((t) => t.taskId)).toEqual([tasks.find((t) => t.status === column)!.taskId])
    }
  })

  test("multiple tasks in the same column are all kept, in input order", () => {
    const tasks = [task("t1", "running"), task("t2", "running"), task("t3", "pending")]
    const grouping = groupByColumn(tasks)
    expect(grouping.running.map((t) => t.taskId)).toEqual(["t1", "t2"])
    expect(grouping.pending.map((t) => t.taskId)).toEqual(["t3"])
  })

  test("an unrecognized status is dropped, not silently placed in the wrong column", () => {
    const tasks = [task("t1", "review"), task("t2", "pending")]
    const grouping = groupByColumn(tasks)
    expect(grouping.pending.map((t) => t.taskId)).toEqual(["t2"])
    expect(Object.values(grouping).flat().map((t) => t.taskId)).toEqual(["t2"])
  })

  test("no tasks means every column is empty", () => {
    const grouping = groupByColumn([])
    for (const column of KANBAN_COLUMNS) {
      expect(grouping[column]).toEqual([])
    }
  })
})

describe("allowedMoves — what a person may do to a card", () => {
  test("a pending, assigned or running task can be parked or abandoned", () => {
    for (const status of ["pending", "assigned", "running"]) {
      expect(allowedMoves(status)).toEqual(["blocked", "cancelled"])
    }
  })

  test("a blocked task can be released or abandoned", () => {
    expect(allowedMoves("blocked")).toEqual(["pending", "cancelled"])
  })

  test("finished and unknown tasks accept no move", () => {
    expect(allowedMoves("completed")).toEqual([])
    expect(allowedMoves("cancelled")).toEqual([])
    expect(allowedMoves("review")).toEqual([])
  })

  test("a person can never target an engine-owned column", () => {
    for (const status of KANBAN_COLUMNS) {
      for (const target of allowedMoves(status)) expect(["assigned", "running", "completed"]).not.toContain(target)
    }
  })
})
