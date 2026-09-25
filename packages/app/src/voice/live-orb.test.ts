/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { liveVoiceStates } from "@unifia/contracts/speech"
import { dict as en } from "@/i18n/en"
import { liveOrbView, liveOrbVisual } from "./live-orb"
import { deriveLiveState, INITIAL_LIVE_SNAPSHOT, reduceLive, type LiveEvent, type LiveSnapshot } from "./live-state"

function run(...events: LiveEvent[]): LiveSnapshot {
  return events.reduce(reduceLive, INITIAL_LIVE_SNAPSHOT)
}

const ready: LiveEvent[] = [{ type: "start" }, { type: "connected" }, { type: "agent-state", agent: "listening" }]

function visual(snapshot: LiveSnapshot) {
  return liveOrbVisual(deriveLiveState(snapshot), snapshot)
}

describe("Live topbar orb", () => {
  test("off and static while Live is idle or failed", () => {
    expect(visual(INITIAL_LIVE_SNAPSHOT)).toBe("off")
    expect(visual(run({ type: "start" }, { type: "error", error: "voice_host_unavailable" }))).toBe("off")
    expect(liveOrbView("idle", INITIAL_LIVE_SNAPSHOT).rows).toEqual([])
  })

  test("follows a full voice turn", () => {
    expect(visual(run({ type: "start" }))).toBe("thinking")
    expect(visual(run(...ready))).toBe("idle")
    expect(visual(run(...ready, { type: "user-speaking", speaking: true }))).toBe("listening")
    expect(visual(run(...ready, { type: "agent-state", agent: "thinking" }))).toBe("thinking")
    expect(visual(run(...ready, { type: "agent-task", task: "working" }))).toBe("working")
    expect(visual(run(...ready, { type: "agent-state", agent: "speaking" }))).toBe("speaking")
  })

  test("a pending permission or question outranks work and speech", () => {
    const blocked = run(
      ...ready,
      { type: "agent-task", task: "working" },
      { type: "attention", attention: "permission" },
    )
    const view = liveOrbView(deriveLiveState(blocked), blocked)
    expect(view.visual).toBe("attention")
    expect(view.title).toBe("live.orb.copy.attention.permission.title")
    expect(view.rows.find((row) => row.id === "human")).toEqual({
      id: "human",
      tone: "blocked",
      value: "live.orb.row.human.permission",
    })
  })

  test("rows report the host, the agent and the user from the snapshot", () => {
    const working = run(...ready, { type: "agent-task", task: "working" })
    const view = liveOrbView(deriveLiveState(working), working)
    expect(view.busy).toBe(true)
    expect(view.rows.map((row) => [row.id, row.tone])).toEqual([
      ["host", "done"],
      ["agent", "active"],
      ["human", "pending"],
    ])
    const reconnecting = run(...ready, { type: "reconnecting" })
    expect(liveOrbView(deriveLiveState(reconnecting), reconnecting).rows[0].value).toBe(
      "live.orb.row.host.reconnecting",
    )
  })

  test("every key the orb can render exists in English", () => {
    const snapshots = [
      INITIAL_LIVE_SNAPSHOT,
      run({ type: "start" }),
      run(...ready),
      run(...ready, { type: "reconnecting" }),
      run(...ready, { type: "user-speaking", speaking: true }),
      run(...ready, { type: "user-speaking", speaking: true }, { type: "user-speaking", speaking: false }),
      run(...ready, { type: "agent-state", agent: "thinking" }),
      run(...ready, { type: "agent-state", agent: "speaking" }),
      run(...ready, { type: "agent-task", task: "working" }),
      run(...ready, { type: "attention", attention: "permission" }),
      run(...ready, { type: "attention", attention: "question" }),
    ]
    const keys = new Set<string>()
    for (const snapshot of snapshots) {
      const view = liveOrbView(deriveLiveState(snapshot), snapshot)
      keys.add(view.title)
      keys.add(view.detail)
      for (const row of view.rows) keys.add(row.value)
    }
    for (const state of liveVoiceStates) {
      if (state === "idle" || state === "error") continue
      keys.add(`live.orb.copy.${state}.title`)
      keys.add(`live.orb.copy.${state}.detail`)
    }
    const dict = en as Record<string, string>
    expect([...keys].filter((key) => !dict[key])).toEqual([])
  })
})
