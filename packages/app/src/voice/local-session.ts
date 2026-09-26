/* SPDX-License-Identifier: MIT */

export interface LocalVoiceSessionClient {
  create(input: { directory: string; title: string }): Promise<{
    data?: { id: string }
    error?: unknown
  }>
  prompt(input: {
    sessionID: string
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
  directory: string
  sessionID?: string
  onSession: (sessionID: string) => void
}) {
  let sessionID = input.sessionID
  let creating: Promise<string> | undefined

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
      const currentSessionID = await ensureSession()
      const result = await input.client.prompt({
        sessionID: currentSessionID,
        directory: input.directory,
        agent: options.agent,
        model: options.model,
        variant: options.variant ?? undefined,
        signal,
        parts: [{ type: "text", text: transcript }],
      })
      if (result.error) throw result.error
      if (!result.data) throw new Error("Unifia did not return the voice response")
      return result.data.parts
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join("")
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
      const currentSessionID = await ensureSession()
      const stream = input.client.promptStream({
        sessionID: currentSessionID,
        directory: input.directory,
        agent: options.agent,
        model: options.model,
        variant: options.variant ?? undefined,
        signal,
        parts: [{ type: "text", text: transcript }],
      })
      for await (const chunk of stream) {
        if (signal?.aborted) return
        yield chunk
      }
    },
  }
}
