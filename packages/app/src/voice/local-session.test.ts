/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  createLocalVoiceSession,
  type LocalVoiceSessionClient,
  type LocalVoiceStreamChunk,
} from "./local-session"
import type { VoiceCoreRuntimeClient } from "./voice-core-runtime"

function setup(sessionID?: string) {
  const created: Array<{ directory: string; title: string }> = []
  const prompts: Array<Parameters<LocalVoiceSessionClient["prompt"]>[0]> = []
  const adopted: string[] = []
  const client: LocalVoiceSessionClient = {
    async create(input) {
      created.push(input)
      return { data: { id: "ses_local" } }
    },
    async prompt(input) {
      prompts.push(input)
      return { data: { parts: [{ type: "text", text: "Bonjour." }, { type: "tool", text: "hidden" }] } }
    },
  }
  const session = createLocalVoiceSession({ client, directory: "D:/project", sessionID, onSession: (id) => adopted.push(id) })
  return { session, created, prompts, adopted }
}

describe("createLocalVoiceSession", () => {
  test("reuses the current session and forwards the selected Unifia model and agent", async () => {
    const { session, created, prompts } = setup("ses_existing")
    const response = await session.submit("  Bonjour  ", {
      agent: "build",
      model: { providerID: "local-llm", modelID: "qwen" },
      variant: "fast",
    })
    expect(created).toEqual([])
    expect(prompts[0]).toMatchObject({
      sessionID: "ses_existing",
      directory: "D:/project",
      agent: "build",
      model: { providerID: "local-llm", modelID: "qwen" },
      variant: "fast",
      parts: [{ type: "text", text: "Bonjour" }],
    })
    expect(response).toBe("Bonjour.")
  })

  test("creates and adopts one session on the first non-empty turn", async () => {
    const { session, created, prompts, adopted } = setup()
    expect(await session.submit("  ", {})).toBe("")
    expect(created).toEqual([])
    await session.submit("Salut", {})
    expect(created).toEqual([{ directory: "D:/project", title: "Voice conversation" }])
    expect(adopted).toEqual(["ses_local"])
    expect(prompts[0].sessionID).toBe("ses_local")
  })

  test("surfaces session creation and model errors", async () => {
    const failed: LocalVoiceSessionClient = {
      async create() { return { error: new Error("session denied") } },
      async prompt() { return { error: new Error("prompt denied") } },
    }
    const createSession = createLocalVoiceSession({ client: failed, directory: "D:/project", onSession: () => {} })
    await expect(createSession.submit("hello", {})).rejects.toThrow("session denied")

    const promptSession = createLocalVoiceSession({
      client: failed,
      directory: "D:/project",
      sessionID: "ses_existing",
      onSession: () => {},
    })
    await expect(promptSession.submit("hello", {})).rejects.toThrow("prompt denied")
  })

  test("forwards cancellation to the Unifia prompt request", async () => {
    const { session, prompts } = setup("ses_existing")
    const abort = new AbortController()
    await session.submit("hello", {}, abort.signal)
    expect(prompts[0].signal).toBe(abort.signal)
  })

  test("durably reserves the SDK message ID before submission and records the final response", async () => {
    const order: string[] = []
    let submittedMessageID = ""
    const voiceCore: VoiceCoreRuntimeClient = {
      async openSession(sessionID) {
        order.push(`open:${sessionID}`)
        return 1
      },
      async remainingTurnCapacity() { return 1 },
      async beginTurn(sessionID, turnID) {
        order.push(`begin:${sessionID}:${turnID}`)
      },
      async publish(sessionID, turnID, event) {
        order.push(`publish:${event.kind}:${sessionID}:${turnID ?? ""}`)
      },
      async publishTextDelta() {},
      async closeSession(sessionID) {
        order.push(`close:${sessionID}`)
      },
    }
    const client: LocalVoiceSessionClient = {
      async create() { return { data: { id: "ses_core" } } },
      async prompt(request) {
        submittedMessageID = request.messageID ?? ""
        order.push(`prompt:${request.sessionID}:${submittedMessageID}`)
        return { data: { parts: [{ type: "text", text: "Response." }] } }
      },
    }
    const session = createLocalVoiceSession({
      client,
      voiceCore,
      directory: "D:/project",
      sessionID: "ses_core",
      onSession: () => {},
    })

    await session.submit("Hello", {})

    expect(submittedMessageID).toMatch(/^msg_/)
    expect(order).toEqual([
      "open:ses_core",
      `begin:ses_core:${submittedMessageID}`,
      `publish:turn_submitted:ses_core:${submittedMessageID}`,
      `publish:agent_thinking:ses_core:${submittedMessageID}`,
      `prompt:ses_core:${submittedMessageID}`,
      `publish:assistant_text_final:ses_core:${submittedMessageID}`,
    ])
    await session.closeVoiceCoreSession()
    expect(order.at(-1)).toBe("close:ses_core")
  })

  test("does not submit to the SDK when durable turn reservation fails", async () => {
    let promptCalled = false
    const client: LocalVoiceSessionClient = {
      async create() { return { data: { id: "ses_reservation" } } },
      async prompt() {
        promptCalled = true
        return { data: { parts: [] } }
      },
    }
    const voiceCore: VoiceCoreRuntimeClient = {
      async openSession() { return 1 },
      async remainingTurnCapacity() { return 1 },
      async beginTurn() { throw new Error("snapshot persistence failed") },
      async publish() {},
      async publishTextDelta() {},
      async closeSession() {},
    }
    const session = createLocalVoiceSession({
      client,
      voiceCore,
      directory: "D:/project",
      sessionID: "ses_reservation",
      onSession: () => {},
    })

    await expect(session.submit("Do not lose this turn", {})).rejects.toThrow("snapshot persistence failed")
    expect(promptCalled).toBe(false)
  })

  test("forks the canonical session before submitting when VoiceCore turn history is full", async () => {
    const order: string[] = []
    const adopted: string[] = []
    const client: LocalVoiceSessionClient = {
      async create() { throw new Error("unused") },
      async fork(request) {
        order.push(`fork:${request.sessionID}`)
        return { data: { id: "ses_voice_fork" } }
      },
      async prompt(request) {
        order.push(`prompt:${request.sessionID}`)
        return { data: { parts: [{ type: "text", text: "Continued." }] } }
      },
    }
    const voiceCore: VoiceCoreRuntimeClient = {
      async openSession(sessionID) { order.push(`open:${sessionID}`); return 1 },
      async remainingTurnCapacity(sessionID) {
        order.push(`capacity:${sessionID}`)
        return sessionID === "ses_voice_full" ? 0 : 4096
      },
      async beginTurn(sessionID, turnID) { order.push(`begin:${sessionID}:${turnID}`) },
      async publish(sessionID, turnID, event) { order.push(`publish:${sessionID}:${turnID}:${event.kind}`) },
      async publishTextDelta() {},
      async closeSession(sessionID) { order.push(`close:${sessionID}`) },
    }
    const session = createLocalVoiceSession({
      client,
      voiceCore,
      directory: "D:/project",
      sessionID: "ses_voice_full",
      onSession: (id) => adopted.push(id),
    })

    const result = await session.submit("Continue", {})

    expect(result).toBe("Continued.")
    expect(adopted).toEqual(["ses_voice_fork"])
    expect(order.slice(0, 5)).toEqual([
      "capacity:ses_voice_full",
      "fork:ses_voice_full",
      "open:ses_voice_fork",
      "close:ses_voice_full",
      "open:ses_voice_fork",
    ])
    expect(order).toContain("prompt:ses_voice_fork")
  })

  test("fails closed at capacity when session forking is unavailable", async () => {
    let promptCalled = false
    const client: LocalVoiceSessionClient = {
      async create() { throw new Error("unused") },
      async prompt() { promptCalled = true; return { data: { parts: [] } } },
    }
    const voiceCore: VoiceCoreRuntimeClient = {
      async openSession() { return 1 },
      async remainingTurnCapacity() { return 0 },
      async beginTurn() {},
      async publish() {},
      async publishTextDelta() {},
      async closeSession() {},
    }
    const session = createLocalVoiceSession({
      client,
      voiceCore,
      directory: "D:/project",
      sessionID: "ses_voice_full",
      onSession: () => {},
    })

    await expect(session.submit("Do not lose this turn", {})).rejects.toThrow("turn history is full")
    expect(promptCalled).toBe(false)
  })

  test("supportsStreaming is false when the client lacks promptStream", () => {
    const { session } = setup("ses_existing")
    expect(session.supportsStreaming()).toBe(false)
  })

  test("submitStream emits the client chunks and honours abort", async () => {
    const chunks: LocalVoiceStreamChunk[] = [
      { kind: "thinking", turnID: "t1" },
      { kind: "assistant_text_delta", delta: "Bonjour", turnID: "t1" },
      { kind: "assistant_text_delta", delta: " à tous", turnID: "t1" },
      { kind: "tool_started", tool: "fs.read", turnID: "t1" },
      { kind: "tool_finished", tool: "fs.read", turnID: "t1", outcome: "ok" },
      { kind: "assistant_text_final", text: "Bonjour à tous", turnID: "t1" },
    ]
    const received: LocalVoiceStreamChunk[] = []
    const client: LocalVoiceSessionClient = {
      async create() { return { data: { id: "ses_stream" } } },
      async prompt() { throw new Error("prompt should not be called when promptStream is implemented") },
      async *promptStream(input: Parameters<NonNullable<LocalVoiceSessionClient["promptStream"]>>[0]) {
        expect(input.sessionID).toBe("ses_stream")
        expect(input.messageID).toMatch(/^msg_/)
        expect(input.signal?.aborted ?? false).toBe(false)
        for (const chunk of chunks) yield chunk
      },
    }
    const session = createLocalVoiceSession({
      client,
      directory: "D:/project",
      onSession: () => {},
    })
    expect(session.supportsStreaming()).toBe(true)
    for await (const chunk of session.submitStream("Bonjour", {})) {
      received.push(chunk)
    }
    expect(received).toEqual(chunks)
  })

  test("submitStream returns no chunks when the client has no promptStream", async () => {
    const { session } = setup("ses_existing")
    const received: LocalVoiceStreamChunk[] = []
    for await (const chunk of session.submitStream("hello", {})) received.push(chunk)
    expect(received).toEqual([])
  })

  test("submitStream reserves one SDK message ID and sequences semantic chunks before yielding", async () => {
    const order: string[] = []
    let streamMessageID = ""
    const client: LocalVoiceSessionClient = {
      async create() { return { data: { id: "ses_stream_core" } } },
      async prompt() { throw new Error("unused") },
      async *promptStream(request) {
        streamMessageID = request.messageID
        yield { kind: "assistant_text_delta", delta: "Hi", turnID: request.messageID }
        yield { kind: "assistant_text_final", text: "Hi", turnID: request.messageID }
      },
    }
    const voiceCore: VoiceCoreRuntimeClient = {
      async openSession() { order.push("open"); return 1 },
      async remainingTurnCapacity() { return 1 },
      async beginTurn(_sessionID, turnID) { order.push(`begin:${turnID}`) },
      async publish(_sessionID, turnID, event) { order.push(`event:${turnID}:${event.kind}`) },
      async publishTextDelta(_sessionID, turnID, delta) { order.push(`delta:${turnID}:${delta}`) },
      async closeSession() {},
    }
    const session = createLocalVoiceSession({
      client,
      voiceCore,
      directory: "D:/project",
      sessionID: "ses_stream_core",
      onSession: () => {},
    })
    const chunks: LocalVoiceStreamChunk[] = []
    for await (const chunk of session.submitStream("hello", {})) chunks.push(chunk)

    expect(streamMessageID).toMatch(/^msg_/)
    expect(chunks.map((chunk) => chunk.kind)).toEqual(["assistant_text_delta", "assistant_text_final"])
    expect(order).toEqual([
      "open",
      `begin:${streamMessageID}`,
      `event:${streamMessageID}:turn_submitted`,
      `event:${streamMessageID}:agent_thinking`,
      `delta:${streamMessageID}:Hi`,
      `event:${streamMessageID}:assistant_text_final`,
    ])
  })

  test("submitStream stops emitting once the AbortSignal fires", async () => {
    const client: LocalVoiceSessionClient = {
      async create() { return { data: { id: "ses_abort" } } },
      async prompt() { throw new Error("unused") },
      async *promptStream() {
        yield { kind: "assistant_text_delta", delta: "ok", turnID: "t1" }
        yield { kind: "assistant_text_delta", delta: "more", turnID: "t1" }
      },
    }
    const session = createLocalVoiceSession({ client, directory: "D:/project", onSession: () => {} })
    const abort = new AbortController()
    const received: LocalVoiceStreamChunk[] = []
    for await (const chunk of session.submitStream("hi", {}, abort.signal)) {
      received.push(chunk)
      abort.abort()
    }
    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[received.length - 1]).toEqual({ kind: "assistant_text_delta", delta: "ok", turnID: "t1" })
  })

  test("submitStream ignores whitespace-only transcripts (no create, no chunks)", async () => {
    const created: string[] = []
    const client: LocalVoiceSessionClient = {
      async create() { created.push("called"); return { data: { id: "ses_blank" } } },
      async prompt() { throw new Error("unused") },
      async *promptStream() { yield { kind: "assistant_text_delta", delta: "x", turnID: "t1" } },
    }
    const session = createLocalVoiceSession({ client, directory: "D:/project", onSession: () => {} })
    const received: LocalVoiceStreamChunk[] = []
    for await (const chunk of session.submitStream("   ", {})) received.push(chunk)
    expect(received).toEqual([])
    expect(created).toEqual([])
  })
})
