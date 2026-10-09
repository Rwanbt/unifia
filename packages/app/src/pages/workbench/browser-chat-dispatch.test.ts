/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { BrowserSession } from "@unifia/contracts"
import { createBrowserChatDispatch, dispatchBrowserChatPrompt, type BrowserPromptClient } from "./browser-chat-dispatch"
import { browserSessionStorageKey } from "./browser-session-storage"

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

describe("createBrowserChatDispatch", () => {
  function harness(options: { destination?: string; routeSessionId?: string } = {}) {
    const sent: Array<{ chatSessionId: string; browserSessionId: string }> = []
    let connects = 0
    const stored = new Map<string, string>()
    const client = {
      async getBrowserSession() { throw new Error("missing session") },
      async createBrowserSession(input: { workspaceId: string; chatSessionId: string }) {
        return { session: createSession(`browser-for-${input.chatSessionId}`, input.workspaceId, input.chatSessionId) }
      },
      async sendSessionPrompt(_workspaceId: string, chatSessionId: string, _prompt: Record<string, unknown>, browserSessionId: string) {
        sent.push({ chatSessionId, browserSessionId })
        return { accepted: true, operationId: "operation-1" }
      },
    } as unknown as BrowserPromptClient
    const dispatch = createBrowserChatDispatch({
      destination: () => options.destination ?? "browser",
      ensureConnected: async () => {
        connects += 1
        return { client, workspaceId: "workspace" } as never
      },
      routeSessionId: () => options.routeSessionId,
      storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value) } },
    })
    return { dispatch, sent, stored, connects: () => connects }
  }

  test("outside Browser mode it declines without connecting, so the normal path sends", async () => {
    const { dispatch, sent, connects } = harness({ destination: "code", routeSessionId: "chat" })

    expect(await dispatch({ sessionID: "chat" })).toBeUndefined()
    expect(connects()).toBe(0)
    expect(sent).toHaveLength(0)
  })

  test("in Browser mode it sends through the chat-linked session and reports it as sent", async () => {
    const { dispatch, sent, stored } = harness({ routeSessionId: "chat" })

    expect(await dispatch({ sessionID: "chat" })).toBe(true)
    expect(sent).toEqual([{ chatSessionId: "chat", browserSessionId: "browser-for-chat" }])
    expect(stored.get(browserSessionStorageKey("workspace", "chat"))).toBe("browser-for-chat")
  })

  test("the route's session wins over the request's", async () => {
    const { dispatch, sent } = harness({ routeSessionId: "route-chat" })

    await dispatch({ sessionID: "request-chat" })

    expect(sent[0]?.chatSessionId).toBe("route-chat")
  })

  test("a new chat with no route session falls back to the request's session", async () => {
    const { dispatch, sent } = harness({ routeSessionId: "" })

    await dispatch({ sessionID: "request-chat" })

    expect(sent[0]?.chatSessionId).toBe("request-chat")
  })

  test("with no session anywhere it refuses instead of creating an unlinked Browser", async () => {
    const { dispatch, sent } = harness({ routeSessionId: undefined })

    await expect(dispatch({})).rejects.toThrow("Browser chat is not linked to a session yet")
    expect(sent).toHaveLength(0)
  })
})
