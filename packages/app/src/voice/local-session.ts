/* SPDX-License-Identifier: MIT */
import { Identifier } from "@/utils/id"
import type { VoiceCoreEvent, VoiceCoreRuntimeClient } from "./voice-core-runtime"

export interface LocalVoiceSessionClient {
  create(input: { directory: string; title: string }): Promise<{
    data?: { id: string }
    error?: unknown
  }>
  fork?(input: { sessionID: string; directory: string }): Promise<{
    data?: { id: string }
    error?: unknown
  }>
  prompt(input: {
    sessionID: string
    messageID?: string
    directory: string
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    signal?: AbortSignal
    parts: Array<{ type: "text"; text: string }>
  }): Promise<{
    data?: { parts: Array<{ type: string; text?: string }> }
    error?: unknown
  }>
  /**
   * Optional streaming variant of `prompt`. When implemented, the
   * Unifia runtime emits semantic events as they happen (per the v2
   * plan §27 / ADR-060). When absent, the session falls back to
   * the synchronous `prompt` path so existing clients keep working
   * unchanged.
   */
  promptStream?(input: {
    sessionID: string
    messageID: string
    directory: string
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    signal?: AbortSignal
    parts: Array<{ type: "text"; text: string }>
  }): AsyncIterable<LocalVoiceStreamChunk>
}

export type LocalVoiceStreamChunk =
  | { kind: "assistant_text_delta"; delta: string; turnID: string }
  | { kind: "assistant_text_final"; text: string; turnID: string }
  | { kind: "tool_started"; tool: string; turnID: string }
  | { kind: "tool_finished"; tool: string; turnID: string; outcome: "ok" | "denied" | "errored" }
  | { kind: "permission_required"; permission: string; turnID: string }
  | { kind: "working"; turnID: string }
  | { kind: "thinking"; turnID: string }
  | { kind: "error"; stage: string; code: string; detail: string; turnID?: string }

export interface LocalVoiceTurnOptions {
  directory: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string | null
}

/** Sends finalized local transcripts through the existing Unifia session API. */
export function createLocalVoiceSession(input: {
  client: LocalVoiceSessionClient
  voiceCore?: VoiceCoreRuntimeClient
  directory: string
  sessionID?: string
  onSession: (sessionID: string) => void
}) {
  let sessionID = input.sessionID
  let creating: Promise<string> | undefined
  let pendingRotation: { previousSessionID: string; nextSessionID: string } | undefined

  async function ensureSession(): Promise<string> {
    if (sessionID) return sessionID
    if (creating) return creating

    creating = (async () => {
      const result = await input.client.create({ directory: input.directory, title: "Voice conversation" })
      if (result.error) throw result.error
      const created = result.data?.id
      if (!created) throw new Error("Unifia did not return the created voice session id")
      sessionID = created
      input.onSession(created)
      return created
    })()

    try {
      return await creating
    } finally {
      creating = undefined
    }
  }

  async function openVoiceCoreSession(currentSessionID: string): Promise<void> {
    if (!input.voiceCore) return
    await input.voiceCore.openSession(currentSessionID)
  }

  async function beginVoiceCoreTurn(currentSessionID: string, messageID: string): Promise<void> {
    if (!input.voiceCore) return
    await openVoiceCoreSession(currentSessionID)
    await input.voiceCore.beginTurn(currentSessionID, messageID)
    await input.voiceCore.publish(currentSessionID, messageID, {
      kind: "turn_submitted",
      message_id: messageID,
    })
    await input.voiceCore.publish(currentSessionID, messageID, { kind: "agent_thinking" })
  }

  async function ensureTurnSession(): Promise<string> {
    const currentSessionID = await ensureSession()
    if (!input.voiceCore) return currentSessionID

    if (!pendingRotation) {
      const remaining = await input.voiceCore.remainingTurnCapacity(currentSessionID)
      if (!Number.isSafeInteger(remaining) || remaining < 0) {
        throw new Error("VoiceCore returned an invalid turn-capacity value")
      }
      if (remaining > 0) return currentSessionID
      if (!input.client.fork) {
        throw new Error("VoiceCore turn history is full and this runtime cannot fork the Unifia session")
      }
      const result = await input.client.fork({ sessionID: currentSessionID, directory: input.directory })
      if (result.error) throw result.error
      const nextSessionID = result.data?.id
      if (!nextSessionID || nextSessionID === currentSessionID) {
        throw new Error("Unifia did not return a distinct forked Voice session")
      }
      pendingRotation = { previousSessionID: currentSessionID, nextSessionID }
    }

    const rotation = pendingRotation
    await openVoiceCoreSession(rotation.nextSessionID)
    await input.voiceCore.closeSession(rotation.previousSessionID)
    sessionID = rotation.nextSessionID
    pendingRotation = undefined
    input.onSession(sessionID)
    return sessionID
  }

  return {
    get sessionID() {
      return sessionID
    },
    supportsStreaming(): boolean {
      return typeof input.client.promptStream === "function"
    },
    async submit(text: string, options: Omit<LocalVoiceTurnOptions, "directory">, signal?: AbortSignal): Promise<string> {
      const transcript = text.trim()
      if (!transcript) return ""
      const currentSessionID = await ensureTurnSession()
      const messageID = Identifier.ascending("message")
      await beginVoiceCoreTurn(currentSessionID, messageID)
      const result = await input.client.prompt({
        sessionID: currentSessionID,
        messageID,
        directory: input.directory,
        agent: options.agent,
        model: options.model,
        variant: options.variant ?? undefined,
        signal,
        parts: [{ type: "text", text: transcript }],
      })
      if (result.error) throw result.error
      if (!result.data) throw new Error("Unifia did not return the voice response")
      const response = result.data.parts
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join("")
      if (input.voiceCore) {
        await input.voiceCore.publish(currentSessionID, messageID, {
          kind: "assistant_text_final",
          text: response,
        })
      }
      return response
    },
    /**
     * Streaming submit. Returns an empty async iterable when the
     * client does not implement `promptStream`; callers should check
     * `supportsStreaming()` first and fall back to `submit()` when
     * false. The async iterable respects the AbortSignal — when the
     * signal fires, the iterator is closed and the underlying
     * `promptStream` must terminate its work (per ADR-060 §"Two-stage
     * barge-in" / "cancel speech != cancel agent work").
     */
    async *submitStream(
      text: string,
      options: Omit<LocalVoiceTurnOptions, "directory">,
      signal?: AbortSignal,
    ): AsyncIterable<LocalVoiceStreamChunk> {
      if (!input.client.promptStream) return
      const transcript = text.trim()
      if (!transcript) return
      const currentSessionID = await ensureTurnSession()
      const messageID = Identifier.ascending("message")
      await beginVoiceCoreTurn(currentSessionID, messageID)
      const stream = input.client.promptStream({
        sessionID: currentSessionID,
        messageID,
        directory: input.directory,
        agent: options.agent,
        model: options.model,
        variant: options.variant ?? undefined,
        signal,
        parts: [{ type: "text", text: transcript }],
      })
      for await (const chunk of stream) {
        if (signal?.aborted) return
        if (input.voiceCore) {
          if (chunk.kind === "assistant_text_delta") {
            await input.voiceCore.publishTextDelta(currentSessionID, messageID, chunk.delta)
          } else {
            const event = voiceCoreEventForChunk(chunk)
            if (event) await input.voiceCore.publish(currentSessionID, messageID, event)
          }
        }
        yield chunk
      }
    },
    async closeVoiceCoreSession(): Promise<void> {
      if (!input.voiceCore || !sessionID) return
      await input.voiceCore.closeSession(sessionID)
    },
  }
}

function voiceCoreEventForChunk(
  chunk: Exclude<LocalVoiceStreamChunk, { kind: "assistant_text_delta" }>,
): VoiceCoreEvent | undefined {
  switch (chunk.kind) {
    case "assistant_text_final":
      return { kind: "assistant_text_final", text: chunk.text }
    case "tool_started":
      return { kind: "tool_started", tool: chunk.tool }
    case "tool_finished":
      return { kind: "tool_finished", tool: chunk.tool, outcome: chunk.outcome }
    case "permission_required":
      return { kind: "permission_required", permission: chunk.permission }
    case "working":
      return { kind: "agent_working", tool: null }
    case "thinking":
      return { kind: "agent_thinking" }
    case "error":
      return undefined
  }
}
