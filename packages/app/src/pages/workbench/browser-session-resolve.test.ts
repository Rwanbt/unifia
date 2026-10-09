/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { BrowserSession } from "@unifia/contracts"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import { applyBrowserNavigationRequest, resolveBrowserSession, type BrowserSessionStore } from "./browser-session-resolve"
import { browserSessionStorageKey, legacyBrowserSessionStorageKey } from "./browser-session-storage"

const session = (id: string, chatSessionId: string | undefined, tabs = 0): BrowserSession =>
  ({
    id,
    workspaceId: "ws",
    chatSessionId,
    profileId: "p",
    runtimeProfile: "isolated",
    controller: "ai",
    tabs: Array.from({ length: tabs }, (_, index) => ({ id: `t${index}`, pageId: `p${index}`, url: "about:blank", origin: null, title: "", loading: false, canGoBack: false, canGoForward: false, status: "ready" })),
    activeTabId: tabs ? "t0" : null,
    viewport: { width: 1280, height: 800 },
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  }) as BrowserSession

function harness(existing: Record<string, BrowserSession>) {
  const calls: string[] = []
  const client = {
    getBrowserSession: async (_ws: string, id: string) => {
      calls.push(`get ${id}`)
      const found = existing[id]
      if (!found) throw new Error("not found")
      return { session: found }
    },
    createBrowserSession: async (input: { chatSessionId?: string }) => {
      calls.push(`create ${input.chatSessionId}`)
      return { session: session("new", input.chatSessionId) }
    },
    openBrowserTab: async (_ws: string, id: string, url?: string) => {
      calls.push(`open ${id} ${url ?? ""}`)
      return { session: session(id, existing[id]?.chatSessionId, 1) }
    },
    setBrowserController: async (_ws: string, id: string, controller: string) => {
      calls.push(`control ${controller}`)
      return { session: { ...session(id, "chat", 1), controller } }
    },
    navigateBrowserTab: async (_ws: string, id: string, tab: string, url: string) => {
      calls.push(`navigate ${tab} ${url}`)
      return { session: { ...session(id, "chat", 1), controller: "user" } }
    },
  }
  const connection = { client, workspaceId: "ws", grants: new Set<string>() } as unknown as WorkbenchConnection
  const values = new Map<string, string>()
  const store: BrowserSessionStore = { read: (key) => values.get(key), write: (key, value) => void values.set(key, value) }
  return { calls, connection, values, store }
}

describe("resolveBrowserSession", () => {
  test("StoredSessionOfThisChat_IsReused", async () => {
    const h = harness({ a: session("a", "chat") })
    h.values.set(browserSessionStorageKey("ws", "chat"), "a")
    expect((await resolveBrowserSession({ connection: h.connection, chatSessionId: "chat", store: h.store })).id).toBe("a")
    expect(h.calls).toEqual(["get a"])
  })

  test("StoredSessionOfAnotherChat_IsNeverReused", async () => {
    const h = harness({ a: session("a", "other") })
    h.values.set(browserSessionStorageKey("ws", "chat"), "a")
    const resolved = await resolveBrowserSession({ connection: h.connection, chatSessionId: "chat", store: h.store })
    expect(resolved.id).toBe("new")
    expect(h.values.get(browserSessionStorageKey("ws", "chat"))).toBe("new")
  })

  test("LegacyWorkspaceKey_IsAdoptedOnlyForTheSameChat", async () => {
    const h = harness({ legacy: session("legacy", "chat") })
    h.values.set(legacyBrowserSessionStorageKey("ws"), "legacy")
    expect((await resolveBrowserSession({ connection: h.connection, chatSessionId: "chat", store: h.store })).id).toBe("legacy")
    expect(h.values.get(browserSessionStorageKey("ws", "chat"))).toBe("legacy")
  })

  test("StaleStoredId_CreatesANewSession", async () => {
    const h = harness({})
    h.values.set(browserSessionStorageKey("ws", "chat"), "gone")
    expect((await resolveBrowserSession({ connection: h.connection, chatSessionId: "chat", store: h.store })).id).toBe("new")
    expect(h.calls).toContain("create chat")
  })
})

describe("applyBrowserNavigationRequest", () => {
  const request = { url: "https://a.dev/", requestId: "r1" }

  test("EmptySession_OpensTheRequestedPageInItsFirstTab", async () => {
    const h = harness({ s: session("s", "chat") })
    const result = await applyBrowserNavigationRequest({ connection: h.connection, session: session("s", "chat"), request, applied: "" })
    expect(h.calls).toEqual(["open s https://a.dev/"])
    expect(result.applied).toBe("s:r1")
  })

  test("HandOff_TakesUserControlThenNavigatesOnce", async () => {
    const h = harness({})
    const first = await applyBrowserNavigationRequest({ connection: h.connection, session: session("s", "chat", 1), request, applied: "" })
    expect(h.calls).toEqual(["control user", "navigate t0 https://a.dev/"])
    await applyBrowserNavigationRequest({ connection: h.connection, session: first.session, request, applied: first.applied })
    expect(h.calls).toHaveLength(2)
  })
})
