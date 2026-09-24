/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { deriveLiveState, INITIAL_LIVE_SNAPSHOT, isLiveActive, reduceLive, type LiveEvent } from "./live-state"

function run(...events: LiveEvent[]) {
  return events.reduce(reduceLive, INITIAL_LIVE_SNAPSHOT)
}

describe("Live voice state machine", () => {
  test("idle until started, then connecting until the agent joins", () => {
    expect(deriveLiveState(INITIAL_LIVE_SNAPSHOT)).toBe("idle")
    expect(deriveLiveState(run({ type: "start" }))).toBe("connecting")
    expect(deriveLiveState(run({ type: "start" }, { type: "connected" }))).toBe("connecting")
    expect(deriveLiveState(run({ type: "start" }, { type: "connected" }, { type: "agent-state", agent: "listening" }))).toBe("listening")
  })

  const ready: LiveEvent[] = [{ type: "start" }, { type: "connected" }, { type: "agent-state", agent: "listening" }]

  test("a full turn: listening -> processing -> thinking -> speaking -> listening", () => {
    let s = run(...ready, { type: "user-speaking", speaking: true })
    expect(deriveLiveState(s)).toBe("listening")
    s = reduceLive(s, { type: "user-speaking", speaking: false })
    expect(deriveLiveState(s)).toBe("processing")
    s = reduceLive(s, { type: "agent-state", agent: "thinking" })
    expect(deriveLiveState(s)).toBe("thinking")
    s = reduceLive(s, { type: "agent-state", agent: "speaking" })
    expect(deriveLiveState(s)).toBe("speaking")
    s = reduceLive(s, { type: "agent-state", agent: "listening" })
    expect(deriveLiveState(s)).toBe("listening")
  })

  test("working is distinct from thinking and survives the agent going quiet", () => {
    let s = run(...ready, { type: "agent-task", task: "working" }, { type: "agent-state", agent: "listening" })
    expect(deriveLiveState(s)).toBe("working")
    // The user can still talk while work continues.
    s = reduceLive(s, { type: "user-speaking", speaking: true })
    expect(deriveLiveState(s)).toBe("listening")
    s = reduceLive(s, { type: "user-speaking", speaking: false })
    expect(deriveLiveState(s)).toBe("working")
    s = reduceLive(s, { type: "agent-task", task: "idle" })
    expect(deriveLiveState(s)).toBe("processing")
  })

  test("barge-in: user speech while the agent speaks keeps speaking until the agent stops", () => {
    let s = run(...ready, { type: "agent-state", agent: "speaking" }, { type: "user-speaking", speaking: true })
    expect(deriveLiveState(s)).toBe("speaking")
    s = reduceLive(s, { type: "agent-state", agent: "listening" })
    expect(deriveLiveState(s)).toBe("listening")
  })

  test("reconnecting keeps the conversation and returns to listening", () => {
    let s = run(...ready, { type: "reconnecting" })
    expect(deriveLiveState(s)).toBe("reconnecting")
    expect(isLiveActive(deriveLiveState(s))).toBe(true)
    s = reduceLive(s, { type: "reconnected" })
    expect(deriveLiveState(s)).toBe("listening")
  })

  test("errors carry a code and stop resets everything", () => {
    const s = run(...ready, { type: "error", error: "voice_host_unavailable" })
    expect(deriveLiveState(s)).toBe("error")
    expect(s.error).toBe("voice_host_unavailable")
    expect(isLiveActive("error")).toBe(false)
    expect(run(...ready, { type: "stop" })).toEqual(INITIAL_LIVE_SNAPSHOT)
  })

  test("late transport events after stop do not resurrect a session", () => {
    const s = run({ type: "stop" }, { type: "connected" }, { type: "reconnecting" })
    expect(deriveLiveState(s)).toBe("idle")
  })
})
