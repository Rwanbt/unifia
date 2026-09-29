/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createTauriVoiceCoreRuntime } from "./voice-core-runtime"

describe("createTauriVoiceCoreRuntime", () => {
  test("uses the registered Tauri commands and preserves event correlation", async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = []
    const client = createTauriVoiceCoreRuntime(async (command, args) => {
      calls.push({ command, args })
      if (command === "voice_core_open_session") return 3
      if (command === "voice_core_remaining_turn_capacity") return 4096
      return undefined
    })

    expect(await client.openSession("ses_voice")).toBe(3)
    expect(await client.remainingTurnCapacity("ses_voice")).toBe(4096)
    await client.beginTurn("ses_voice", "msg_turn")
    await client.publish("ses_voice", "msg_turn", { kind: "agent_thinking" })
    await client.publishTextDelta("ses_voice", "msg_turn", "Hello")
    await client.closeSession("ses_voice")

    expect(calls).toEqual([
      { command: "voice_core_open_session", args: { sessionId: "ses_voice" } },
      { command: "voice_core_remaining_turn_capacity", args: { sessionId: "ses_voice" } },
      { command: "voice_core_begin_turn", args: { sessionId: "ses_voice", turnId: "msg_turn" } },
      {
        command: "voice_core_publish",
        args: { sessionId: "ses_voice", turnId: "msg_turn", event: { kind: "agent_thinking" } },
      },
      {
        command: "voice_core_publish_text_delta",
        args: { sessionId: "ses_voice", turnId: "msg_turn", delta: "Hello" },
      },
      { command: "voice_core_close_session", args: { sessionId: "ses_voice" } },
    ])
  })
})
