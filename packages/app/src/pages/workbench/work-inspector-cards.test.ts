/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { workInspectorCards } from "./work-inspector-cards"

const t = (key: string, params?: Record<string, string | number>) =>
  (en as Record<string, string>)[key]!.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name]))

const task = (taskId: string, status: string, dependsOn: string[] = []) => ({ taskId, status, dependsOn }) as TeamGraphTask

describe("workInspectorCards", () => {
  test("NoRun_ShowsTheHonestEmptyCard", () => {
    const cards = workInspectorCards({ run: undefined, tasks: [], progress: { completed: 0, total: 0, percent: 0 }, health: "ok" }, t)
    expect(cards).toEqual([{ title: "Nothing to inspect", description: "Nothing is open in this mode yet." }])
  })

  test("ActiveRun_ListsItsRealFactsAndNextTask", () => {
    const tasks = [task("a", "completed"), task("b", "pending", ["a"])]
    const cards = workInspectorCards(
      { run: { runId: "run-7", status: "running", updatedAt: "" }, tasks, progress: { completed: 1, total: 2, percent: 50 }, health: "risk" },
      t,
    )
    expect(cards[0]).toMatchObject({ title: "run-7" })
    expect(Object.fromEntries(inspectorRows(cards[0]!).map((row) => [row.label, row.value]))).toEqual({
      Status: "Running",
      Health: "At risk",
      Progress: "1/2 · 50%",
    })
    expect(Object.fromEntries(inspectorRows(cards[1]!).map((row) => [row.label, row.value]))).toEqual({
      Task: "b",
      Status: "Pending",
      Dependencies: "1",
    })
  })

  test("ClosedRun_DoesNotRecommendItsPendingTask", () => {
    const cards = workInspectorCards(
      { run: { runId: "closed", status: "failed", updatedAt: "" }, tasks: [task("a", "pending")], progress: { completed: 0, total: 1, percent: 0 }, health: "risk" },
      t,
    )
    expect(cards).toHaveLength(1)
  })

  test("UnknownRunStatus_IsShownAsIs", () => {
    const cards = workInspectorCards(
      { run: { runId: "r", status: "cancelled_x", updatedAt: "" }, tasks: [], progress: { completed: 0, total: 0, percent: 0 }, health: "ok" },
      t,
    )
    expect(inspectorRows(cards[0]!)[0]!.value).toBe("cancelled_x")
    expect(cards).toHaveLength(1)
  })
})
