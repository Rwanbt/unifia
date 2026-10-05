/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { BrowserSession } from "@unifia/contracts"
import { dispatchBrowserChatPrompt, type BrowserPromptClient } from "./browser-chat-dispatch"

function createSession(id: string, workspaceId: string, chatSessionId: string): BrowserSession {
  return {
    id, workspaceId, chatSessionId, profileId: `profile-${id}`, runtimeProfile: "isolated", controller: "user",
    tabs: [], activeTabId: null, viewport: { width: 1280, height: 800 }, status: "ready", createdAt: 1, updatedAt: 1,
  }
}

describe("Browser chat dispatch", () => {
  test("creates and stores a linked session before sending the first prompt", async () => {
    const operations: string[] = []
    const session = createSession("browser-1", "workspace", "chat")
    const client = {
      async getBrowserSession() { throw new Error("missing session") },
      async createBrowserSession(input: { workspaceId: string; chatSessionId: string }) {
        operations.push(`create:${input.workspaceId}:${input.chatSessionId}`)
        return { session }
      },
      async sendSessionPrompt(workspaceId: string, chatSessionId: string, _prompt: Record<string, unknown>, sessionId: string) {
        operations.push(`send:${workspaceId}:${chatSessionId}:${sessionId}`)
        return { accepted: true, operationId: "operation-1" }
      },
    } as unknown as BrowserPromptClient
    let storedId: string | null = null

    await dispatchBrowserChatPrompt(client, "workspace", "chat", { sessionID: "chat" }, {
      read: () => storedId,
      write: (value) => { storedId = value; operations.push(`store:${value}`) },
    })

    expect(operations).toEqual(["create:workspace:chat", "store:browser-1", "send:workspace:chat:browser-1"])
  })

  test("reuses only a stored session linked to the exact workspace chat", async () => {
    const linked = createSession("browser-linked", "workspace", "chat")
    let created = 0
    const sent: string[] = []
    const client = {
      async getBrowserSession() { return { session: linked } },
      async createBrowserSession() { created += 1; return { session: createSession("browser-new", "workspace", "chat") } },
      async sendSessionPrompt(_workspaceId: string, _chatSessionId: string, _prompt: Record<string, unknown>, sessionId: string) {
        sent.push(sessionId)
        return { accepted: true, operationId: "operation-2" }
      },
    } as unknown as BrowserPromptClient

    await dispatchBrowserChatPrompt(client, "workspace", "chat", {}, { read: () => linked.id, write() {} })

    expect(created).toBe(0)
    expect(sent).toEqual([linked.id])
  })

  test("refuses a prompt the Workbench did not accept", async () => {
    const client = {
      async getBrowserSession() { throw new Error("missing") },
      async createBrowserSession() { return { session: createSession("browser-1", "workspace", "chat") } },
      async sendSessionPrompt() { return { accepted: false, operationId: "" } },
    } as unknown as BrowserPromptClient

    await expect(dispatchBrowserChatPrompt(client, "workspace", "chat", {}, { read: () => null, write() {} }))
      .rejects.toThrow("Workbench did not accept")
  })
})
