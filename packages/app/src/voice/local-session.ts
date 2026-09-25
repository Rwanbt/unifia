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
}

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
  }
}
