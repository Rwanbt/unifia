/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { browserExecutionEvents, executionRow, executionRows, type ExecutionEvent } from "./execution-log"

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

describe("browserExecutionEvents", () => {
  test("maps actual activity to stable execution rows and omits in-flight actions", () => {
    const mapped = browserExecutionEvents([
      { sequence: 7, sessionId: "s1", tabId: "t1", kind: "action.started", controller: "ai", occurredAt: 10_000, detail: "click Repositories" },
      { sequence: 8, sessionId: "s1", tabId: "t1", kind: "action.completed", controller: "ai", occurredAt: 10_250, detail: "click Repositories" },
      { sequence: 9, sessionId: "s1", kind: "controller.changed", controller: "user", occurredAt: 11_000 },
      { sequence: 10, sessionId: "s1", tabId: "t1", kind: "action.failed", controller: "ai", occurredAt: 12_000, detail: "click Sign in" },
      { sequence: 11, sessionId: "s1", tabId: "t1", kind: "navigation.blocked", controller: "ai", occurredAt: 13_000, detail: "network policy" },
      { sequence: 12, sessionId: "s1", tabId: "t1", kind: "action.approval_denied", controller: "ai", occurredAt: 14_000, detail: "click" },
      { sequence: 13, sessionId: "s1", tabId: "t1", kind: "action.approval_unavailable", controller: "ai", occurredAt: 15_000, detail: "click" },
    ])
    expect(mapped.map((item) => item.eventId)).toEqual(["browser:s1:7", "browser:s1:8", "browser:s1:9", "browser:s1:10", "browser:s1:11", "browser:s1:12", "browser:s1:13"])
    expect(executionRows(mapped, "all", label).map((row) => row.id)).toEqual(["browser:s1:8", "browser:s1:9", "browser:s1:10", "browser:s1:11", "browser:s1:12", "browser:s1:13"])
    expect(executionRows(mapped, "tools", label)[0]?.summary).toBe("click Repositories")
    expect(executionRows(mapped, "tools", label)[2]?.status).toBe("error")
    expect(executionRows(mapped, "tools", label)[3]?.summary).toBe("network policy")
    expect(executionRows(mapped, "tools", label)[3]?.status).toBe("error")
    expect(executionRows(mapped, "tools", label)[4]?.status).toBe("error")
    expect(executionRows(mapped, "tools", label)[5]?.status).toBe("error")
  })
})
