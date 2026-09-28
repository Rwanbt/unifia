/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { Event } from "@unifia/sdk-shared"
import { createSdkLivePromptStream, type LocalPromptEventSource } from "./sdk-live-prompt-stream"

function eventSource() {
  const listeners = new Map<string, Set<(event: never) => void>>()
  const source: LocalPromptEventSource = {
    on(name, listener) {
      const key = String(name)
      const bucket = listeners.get(key) ?? new Set<(event: never) => void>()
      bucket.add(listener as (event: never) => void)
      listeners.set(key, bucket)
      return () => bucket.delete(listener as (event: never) => void)
    },
  }
  return {
    source,
    emit(event: Event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event as never)
    },
  }
}

function userMessage(sessionID: string, messageID: string): Event {
  return {
    type: "message.updated",
    properties: {
      sessionID,
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "local", modelID: "local" },
      },
    },
  }
}

function assistantMessage(sessionID: string, messageID: string, parentID: string): Event {
  return {
    type: "message.updated",
    properties: {
      sessionID,
      info: {
        id: messageID,
        sessionID,
        role: "assistant",
        parentID,
        time: { created: 1 },
        modelID: "local",
        providerID: "local",
        mode: "build",
        agent: "build",
        path: { cwd: "/work", root: "/work" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
  }
}

function textDelta(sessionID: string, messageID: string, partID: string, delta: string): Event {
  return {
    type: "message.part.delta",
    properties: { sessionID, messageID, partID, field: "text", delta },
  }
}

function toolUpdate(completed: boolean): Event {
  return {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_live",
      time: completed ? 3 : 2,
      part: {
        id: "part_tool",
        sessionID: "ses_live",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_1",
        tool: "fs.read",
        state: completed
          ? { status: "completed", input: {}, output: "done", title: "Read", metadata: {}, time: { start: 2, end: 3 } }
          : { status: "running", input: {}, time: { start: 2 } },
      },
    },
  }
}

describe("createSdkLivePromptStream", () => {
  test("streams only the submitted turn's actual SDK deltas and semantic events", async () => {
    const events = eventSource()
    const promptRequests: unknown[] = []
    const stream = createSdkLivePromptStream({
      events: events.source,
      async promptAsync(request) {
        promptRequests.push(request)
        events.emit(userMessage("ses_live", request.messageID))
        events.emit(assistantMessage("ses_live", "msg_assistant", request.messageID))
        events.emit(textDelta("ses_live", "msg_assistant", "part_text", "Bonjour"))
        events.emit(toolUpdate(false))
        events.emit(toolUpdate(true))
        events.emit(textDelta("ses_live", "msg_assistant", "part_text", " à tous"))
        events.emit({ type: "session.idle", properties: { sessionID: "ses_live" } })
        return {}
      },
    })

    const chunks = []
    for await (const chunk of stream({
      sessionID: "ses_live",
      messageID: "msg_voice_turn",
      directory: "/work",
      parts: [{ type: "text", text: "Bonjour" }],
    })) chunks.push(chunk)

    expect(promptRequests).toEqual([{
      sessionID: "ses_live",
      messageID: "msg_voice_turn",
      directory: "/work",
      parts: [{ type: "text", text: "Bonjour" }],
    }])
    expect(chunks).toEqual([
      { kind: "assistant_text_delta", delta: "Bonjour", turnID: "msg_voice_turn" },
      { kind: "working", turnID: "msg_voice_turn" },
      { kind: "tool_started", tool: "fs.read", turnID: "msg_voice_turn" },
      { kind: "tool_finished", tool: "fs.read", outcome: "ok", turnID: "msg_voice_turn" },
      { kind: "assistant_text_delta", delta: " à tous", turnID: "msg_voice_turn" },
      { kind: "assistant_text_final", text: "Bonjour à tous", turnID: "msg_voice_turn" },
    ])
  })

  test("ignores another session and unrelated turns", async () => {
    const events = eventSource()
    const stream = createSdkLivePromptStream({
      events: events.source,
      async promptAsync() {
        events.emit(userMessage("ses_live", "msg_voice_turn"))
        events.emit(assistantMessage("ses_other", "msg_unrelated", "msg_other_turn"))
        events.emit({ type: "session.idle", properties: { sessionID: "ses_other" } })
        events.emit({ type: "session.idle", properties: { sessionID: "ses_live" } })
        return {}
      },
    })

    const chunks = []
    for await (const chunk of stream({
      sessionID: "ses_live",
      messageID: "msg_voice_turn",
      directory: "/work",
      parts: [{ type: "text", text: "Hello" }],
    })) chunks.push(chunk)
    expect(chunks).toEqual([{ kind: "assistant_text_final", text: "", turnID: "msg_voice_turn" }])
  })
})
