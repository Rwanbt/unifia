/* SPDX-License-Identifier: MIT */
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import type { BrowserSession } from "@unifia/contracts"

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
