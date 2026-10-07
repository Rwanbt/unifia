/* SPDX-License-Identifier: MIT */

import type { BrowserSession } from "@unifia/contracts"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import type { BrowserNavigationRequest } from "@/pages/workbench/design-browser-model"
import { browserSessionStorageKey, legacyBrowserSessionStorageKey } from "@/pages/workbench/browser-session-storage"

export const DEFAULT_BROWSER_VIEWPORT = { width: 1280, height: 800 } as const

/** The slice of localStorage the resolver needs; an unavailable store reads as empty. */
export type BrowserSessionStore = {
  read(key: string): string | undefined
  write(key: string, value: string): void
}

export const browserLocalStore: BrowserSessionStore = {
  read(key) {
    try {
      return localStorage.getItem(key) ?? undefined
    } catch {
      return undefined
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // The Workbench session still owns this Browser; losing the pointer only costs a new session next time.
    }
  },
}

type Client = WorkbenchConnection["client"]

async function readSession(client: Client, workspaceId: string, sessionId: string | undefined): Promise<BrowserSession | undefined> {
  if (!sessionId) return undefined
  try {
    return (await client.getBrowserSession(workspaceId, sessionId)).session
  } catch {
    // A stale stored id (session closed or another server) is not an error: a new session replaces it.
    return undefined
  }
}

/**
 * Finds the Browser session linked to this chat, or creates one. A session
 * linked to a different chat is never reused, so one chat's agent cannot act
 * on another chat's page.
 */
export async function resolveBrowserSession(input: {
  connection: WorkbenchConnection
  chatSessionId: string | undefined
  store: BrowserSessionStore
}): Promise<BrowserSession> {
  const { client, workspaceId } = input.connection
  const key = browserSessionStorageKey(workspaceId, input.chatSessionId ?? "unlinked")
  const stored = await readSession(client, workspaceId, input.store.read(key))
  if (stored && stored.chatSessionId === input.chatSessionId) return stored

  if (input.chatSessionId) {
    // Before per-chat keys existed the id was stored per workspace; adopt it only when it already belongs to this chat.
    const legacy = await readSession(client, workspaceId, input.store.read(legacyBrowserSessionStorageKey(workspaceId)))
    if (legacy && legacy.chatSessionId === input.chatSessionId) {
      input.store.write(key, legacy.id)
      return legacy
    }
  }

  const created = (
    await client.createBrowserSession({
      workspaceId,
      chatSessionId: input.chatSessionId,
      runtimeProfile: "isolated",
      viewport: DEFAULT_BROWSER_VIEWPORT,
    })
  ).session
  input.store.write(key, created.id)
  return created
}

/**
 * Applies a navigation request carried by the route (a Design "Open in Browser"
 * hand-off) once per request id. Returns the session to show and the key of the
 * request it consumed, if any.
 */
export async function applyBrowserNavigationRequest(input: {
  connection: WorkbenchConnection
  session: BrowserSession
  request: BrowserNavigationRequest | undefined
  applied: string
}): Promise<{ session: BrowserSession; applied: string }> {
  const { client, workspaceId } = input.connection
  const { request } = input
  let session = input.session
  if (!session.tabs.length) {
    session = (await client.openBrowserTab(workspaceId, session.id, request?.url)).session
    return { session, applied: request ? `${session.id}:${request.requestId}` : input.applied }
  }
  const requestKey = request ? `${session.id}:${request.requestId}` : ""
  const activeTabId = session.activeTabId
  if (!request || !activeTabId || input.applied === requestKey) return { session, applied: input.applied }
  // A user-initiated hand-off takes the wheel: the AI must not keep driving the page the user just asked for.
  if (session.controller !== "user") session = (await client.setBrowserController(workspaceId, session.id, "user")).session
  session = (await client.navigateBrowserTab(workspaceId, session.id, activeTabId, request.url)).session
  return { session, applied: requestKey }
}
