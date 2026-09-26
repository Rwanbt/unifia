/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { validateEventOrdering, type EventOrderingFixture, type OrderingCheckEvent } from "@unifia/contracts/event-ordering"
import {
  createLocalVoiceSession,
  type LocalVoiceSessionClient,
  type LocalVoiceStreamChunk,
} from "./local-session"
import type { VoiceCoreRuntimeClient } from "./voice-core-runtime"

async function loadFixture(): Promise<EventOrderingFixture> {
  return (await Bun.file(new URL("../../../voice-core/fixtures/event-ordering.json", import.meta.url)).json()) as EventOrderingFixture
}

describe("local/Android producer event ordering parity", () => {
  test("a scripted streaming turn publishes canonical kinds in fixture order", async () => {
    const published: OrderingCheckEvent[] = []
    const sessions: string[] = []
    const turns: Array<string | undefined> = []
    const client: LocalVoiceSessionClient = {
      async create() {
        return { data: { id: "ses_emitter" } }
      },
      async prompt() {
        throw new Error("unused")
      },
      async *promptStream(request) {
        yield { kind: "thinking", turnID: request.messageID }
        yield { kind: "working", turnID: request.messageID }
        yield { kind: "tool_started", tool: "shell", turnID: request.messageID }
        yield { kind: "tool_finished", tool: "shell", outcome: "ok", turnID: request.messageID }
        yield { kind: "permission_required", permission: "fs.write", turnID: request.messageID }
        yield { kind: "assistant_text_delta", delta: "Hello ", turnID: request.messageID }
        yield { kind: "assistant_text_delta", delta: "world.", turnID: request.messageID }
        yield { kind: "assistant_text_final", text: "Hello world.", turnID: request.messageID }
      },
    }
    const voiceCore: VoiceCoreRuntimeClient = {
      async openSession() {
        return 1
      },
      async remainingTurnCapacity() {
        return 1
      },
      async beginTurn() {},
      async publish(sessionID, turnID, event) {
        sessions.push(sessionID)
        turns.push(turnID)
        published.push({ kind: event.kind, sessionID })
      },
      async publishTextDelta(sessionID, turnID) {
        sessions.push(sessionID)
        turns.push(turnID)
        published.push({ kind: "assistant_text_delta", sessionID })
      },
      async closeSession() {},
    }
    const session = createLocalVoiceSession({
      client,
      voiceCore,
      directory: "D:/project",
      sessionID: "ses_emitter",
      onSession: () => {},
    })
    const chunks: LocalVoiceStreamChunk[] = []
    for await (const chunk of session.submitStream("hello", {})) chunks.push(chunk)

    expect(published.map((event) => event.kind)).toEqual([
      "turn_submitted",
      "agent_thinking",
      "agent_thinking",
      "agent_working",
      "tool_started",
      "tool_finished",
      "permission_required",
      "assistant_text_delta",
      "assistant_text_delta",
      "assistant_text_final",
    ])
    expect(new Set(sessions)).toEqual(new Set(["ses_emitter"]))
    expect(new Set(turns).size).toBe(1)

    const fixture = await loadFixture()
    expect(validateEventOrdering(published, fixture)).toEqual([])
  })

  test("a published kind sequence that skips submission violates the shared precedence", async () => {
    const fixture = await loadFixture()
    const violated: OrderingCheckEvent[] = [
      { kind: "agent_thinking", sessionID: "ses_emitter" },
      { kind: "assistant_text_delta", sessionID: "ses_emitter" },
      { kind: "turn_submitted", sessionID: "ses_emitter" },
    ]
    expect(validateEventOrdering(violated, fixture).length).toBeGreaterThan(0)
  })
})
