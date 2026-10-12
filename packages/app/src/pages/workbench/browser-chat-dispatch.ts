/* SPDX-License-Identifier: MIT */
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import type { BrowserSession } from "@unifia/contracts"
import { browserSessionStorageKey } from "./browser-session-storage"

export type BrowserPromptClient = Pick<WorkbenchConnection["client"], "getBrowserSession" | "createBrowserSession" | "sendSessionPrompt">
export type BrowserSessionStorage = { read(): string | null; write(sessionId: string): void }

export async function dispatchBrowserChatPrompt(
  client: BrowserPromptClient,
  workspaceId: string,
  chatSessionId: string,
  prompt: Record<string, unknown>,
  storage: BrowserSessionStorage,
): Promise<void> {
  let browserSession: BrowserSession | undefined
  try {
    const storedId = storage.read()
    if (storedId) {
      const loaded = await client.getBrowserSession(workspaceId, storedId)
      if (loaded.session.workspaceId === workspaceId && loaded.session.chatSessionId === chatSessionId) browserSession = loaded.session
    }
  } catch {
    browserSession = undefined
  }

  if (!browserSession) {
    browserSession = (await client.createBrowserSession({
      workspaceId,
      chatSessionId,
      runtimeProfile: "isolated",
      viewport: { width: 1280, height: 800 },
    })).session
    try { storage.write(browserSession.id) } catch { /* The workspace service remains the Browser session authority. */ }
  }

  const result = await client.sendSessionPrompt(workspaceId, chatSessionId, prompt, browserSession.id)
  if (!result.accepted) throw new Error("Workbench did not accept the Browser-linked chat prompt")
}

export type BrowserChatDispatchDeps = {
  /** The visible workspace destination; only "browser" routes prompts through Workbench. */
  destination: () => string
  ensureConnected: () => Promise<Pick<WorkbenchConnection, "client" | "workspaceId">>
  /** The chat session in the route, when the page has one. */
  routeSessionId: () => string | undefined
  storage: Pick<Storage, "getItem" | "setItem">
}

/**
 * The composer's `browserDispatch`: `undefined` outside Browser mode lets the
 * prompt take the normal session path; in Browser mode the prompt goes through
 * the chat-linked Browser session and `true` tells the composer it was sent.
 */
export function createBrowserChatDispatch(deps: BrowserChatDispatchDeps) {
  return async (request: Record<string, unknown>): Promise<boolean | undefined> => {
    if (deps.destination() !== "browser") return undefined
    const connection = await deps.ensureConnected()
    const chatSessionId = deps.routeSessionId() || (typeof request.sessionID === "string" ? request.sessionID : "")
    if (!chatSessionId) throw new Error("Browser chat is not linked to a session yet")
    const storageKey = browserSessionStorageKey(connection.workspaceId, chatSessionId)
    await dispatchBrowserChatPrompt(connection.client, connection.workspaceId, chatSessionId, request, {
      read: () => deps.storage.getItem(storageKey),
      write: (browserSessionId) => deps.storage.setItem(storageKey, browserSessionId),
    })
    return true
  }
}
