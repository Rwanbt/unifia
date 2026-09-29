/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  dailyFromCumulative,
  dayBounds,
  eventKind,
  formatDuration,
  formatDurationCost,
  statusTone,
} from "./settings-observability-format"

describe("observability format", () => {
  test("statusTone_KnownStatuses_MapToReferencePills", () => {
    expect(statusTone("finished")).toBe("ok")
    expect(statusTone("started")).toBe("warn")
    expect(statusTone("failed")).toBe("err")
    expect(statusTone("finished", "orphaned")).toBe("err")
  })

  test("eventKind_TypePrefix_PicksDot", () => {
    expect(eventKind("llm.call.finished", "finished")).toBe("llm")
    expect(eventKind("tool.call.started", "started")).toBe("tool")
    expect(eventKind("session.start", "finished")).toBe("agent")
    expect(eventKind("tool.call.failed", "failed")).toBe("error")
  })

  test("formatDurationCost_MissingParts_ShowDash", () => {
    expect(formatDuration(842)).toBe("842 ms")
    expect(formatDuration(1840)).toBe("1.84 s")
    expect(formatDuration(12_400)).toBe("12.4 s")
    expect(formatDuration(95_000)).toBe("1 min 35 s")
    expect(formatDuration(67_438_600)).toBe("18 h 43 min")
    expect(formatDurationCost(118, undefined)).toBe("118 ms · —")
    expect(formatDurationCost(undefined, undefined)).toBe("—")
    expect(formatDurationCost(842, 12_400_000)).toBe("842 ms · $0.0124")
  })

  test("dayBounds_SevenDays_StartsAtLocalMidnights", () => {
    const bounds = dayBounds(new Date(2026, 8, 24, 15, 30), 7)
    expect(bounds).toHaveLength(8)
    expect(new Date(bounds[0])).toEqual(new Date(2026, 8, 18))
    expect(new Date(bounds[7])).toEqual(new Date(2026, 8, 25))
  })

  test("dailyFromCumulative_Totals_GiveEachDay", () => {
    expect(dailyFromCumulative([10, 7, 7, 2, 0])).toEqual([3, 0, 5, 2])
  })
})
