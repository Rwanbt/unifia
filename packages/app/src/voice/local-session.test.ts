/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createLocalVoiceSession, type LocalVoiceSessionClient } from "./local-session"

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
})
