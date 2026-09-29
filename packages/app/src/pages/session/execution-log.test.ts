/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { executionRow, executionRows, type ExecutionEvent } from "./execution-log"

const label = (status: string) => status

const event = (patch: Partial<ExecutionEvent>): ExecutionEvent => ({
  eventId: patch.eventId ?? "e1",
  type: "tool.call.finished",
  status: "finished",
  tsMs: 1_000,
  ...patch,
})

describe("executionRow", () => {
  test("skips started spans so each call appears once", () => {
    expect(executionRow(event({ type: "tool.call.started", status: "started" }), label)).toBeUndefined()
  })

  test("an llm call answers the Model and Usage filters with its model", () => {
    const row = executionRow(event({ type: "llm.call.finished", metadata: { modelId: "MiniMax-M3" }, durationMs: 2400 }), label)
    expect(row?.filters).toEqual(["model", "usage"])
    expect(row?.summary).toBe("MiniMax-M3 · 2,4 s")
  })

  test("a tool call files under the family of its tool", () => {
    const kind = (toolKind: string) => executionRow(event({ metadata: { toolKind } }), label)?.filters
    expect(kind("bash")).toEqual(["tools"])
    expect(kind("skill")).toEqual(["skills"])
    expect(kind("websearch")).toEqual(["sources"])
    expect(kind("question")).toEqual(["interaction"])
  })

  test("failures and orphans carry the reference's warning colours", () => {
    expect(executionRow(event({ status: "failed", type: "tool.call.failed" }), label)?.status).toBe("error")
    expect(executionRow(event({ derivedStatus: "orphaned" }), label)?.status).toBe("warning")
  })
})

describe("executionRows", () => {
  test("lists terminal rows oldest first, narrowed to the filter", () => {
    const rows = executionRows(
      [
        event({ eventId: "late", tsMs: 3_000, type: "llm.call.finished" }),
        event({ eventId: "early", tsMs: 2_000, metadata: { toolKind: "bash" } }),
        event({ eventId: "start", tsMs: 1_000, type: "llm.call.started", status: "started" }),
      ],
      "all",
      label,
    )
    expect(rows.map((row) => row.id)).toEqual(["early", "late"])
    expect(executionRows([event({ metadata: { toolKind: "bash" } })], "model", label)).toEqual([])
  })
})
