/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { BrowserActivityEvent, BrowserSession, BrowserViewportInput } from "@unifia/contracts"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import { browserPollRequestsPerMinute, createBrowserSessionController, isSecondarySyncTick } from "./browser-session-controller"

const session = (controller: BrowserSession["controller"] = "user"): BrowserSession =>
  ({
    id: "s",
    workspaceId: "ws",
    chatSessionId: "chat",
    profileId: "p",
    runtimeProfile: "isolated",
    controller,
    tabs: [{ id: "t", pageId: "p", url: "https://a.dev/", origin: "https://a.dev", title: "A", loading: false, canGoBack: false, canGoForward: false, status: "ready" }],
    activeTabId: "t",
    viewport: { width: 1280, height: 800 },
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  }) as BrowserSession

function harness(controller: BrowserSession["controller"] = "user") {
  const calls: string[] = []
  // Each frame fetch records how many runtime calls preceded it.
  const frames: number[] = []
  const published: (readonly BrowserActivityEvent[])[] = []
  const live = session(controller)
  const client = {
    getBrowserSession: async () => ({ session: live }),
    createBrowserSession: async () => ({ session: live }),
    getBrowserTabState: async () => ({ session: live }),
    screenshotBrowserTab: async () => {
      frames.push(calls.length)
      return { contentType: "image/png", data: "AAAA" }
    },
    browserActivity: async () => ({ events: [{ sequence: 1, occurredAt: 1, kind: "page.observed" }] }),
    browserDownloads: async () => ({ downloads: [] }),
    navigateBrowserTab: async (_ws: string, _s: string, _t: string, url: string) => {
      calls.push(`navigate ${url}`)
      return { session: live }
    },
    inputBrowserTab: async (_ws: string, _s: string, _t: string, input: BrowserViewportInput) => {
      calls.push(`input ${input.kind}`)
      return { accepted: true, editableFocused: false }
    },
  }
  const connection = { client, workspaceId: "ws", instanceId: "i", grants: new Set(["browser.navigate", "workspace.read"]) } as unknown as WorkbenchConnection
  const values = new Map<string, string>([["unifia.browser.session.v1.ws:chat", "s"]])
  const controllerUnderTest = createBrowserSessionController({
    browserConnection: () => connection,
    ensureBrowserConnected: async () => connection,
    publishActivity: (events) => published.push(events),
    store: { read: (key) => values.get(key), write: (key, value) => void values.set(key, value) },
  })
  return { browser: controllerUnderTest, calls, frames, published }
}

const settle = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 50 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe("createBrowserSessionController", () => {
  test("Load_ShowsTheSessionFrameAndActivity", async () => {
    const h = harness()
    h.browser.load({ directory: "/repo", chatSessionId: "chat", request: undefined })
    await settle(() => h.browser.state.frame !== "")
    expect(h.browser.state.loading).toBe(false)
    expect(h.browser.state.address).toBe("https://a.dev/")
    expect(h.browser.state.frame).toBe("data:image/png;base64,AAAA")
    expect(h.browser.state.activity).toHaveLength(1)
    expect(h.published.at(-1)).toHaveLength(1)
    expect(h.browser.grantedCapabilities()).toEqual(["browser.navigate"])
    h.browser.dispose()
  })

  test("Navigate_InvalidAddress_ReportsWithoutCallingTheRuntime", async () => {
    const h = harness()
    h.browser.load({ directory: "/repo", chatSessionId: "chat", request: undefined })
    await settle(() => !h.browser.state.loading)
    h.browser.navigate("not a url", "invalid")
    expect(h.browser.state.error).toBe("invalid")
    expect(h.calls).toEqual([])
    h.browser.dispose()
  })

  test("SendInput_WhileTheAiControls_IsDropped", async () => {
    const h = harness("ai")
    h.browser.load({ directory: "/repo", chatSessionId: "chat", request: undefined })
    await settle(() => !h.browser.state.loading)
    await h.browser.sendInput({ kind: "key", key: "Enter" })
    expect(h.calls).toEqual([])
    h.browser.dispose()
  })
})

// Mirrors rateBudget in packages/unifia/src/server/workbench.ts; the app cannot import the server package.
const SERVER_REQUESTS_PER_MINUTE = 240

describe("Browser poll budget", () => {
  test("SendInput_RefreshesTheFrameWithoutWaitingForThePoll", async () => {
    const h = harness()
    h.browser.load({ directory: "/repo", chatSessionId: "chat", request: undefined })
    await settle(() => h.browser.state.frame !== "")
    await h.browser.sendInput({ kind: "key", key: "Enter" })
    // settle() gives up after ~250 ms, well under SYNC_INTERVAL_MS: only an input-driven sync fetches this soon.
    await settle(() => h.frames.at(-1) === 1)
    expect(h.calls).toEqual(["input key"])
    expect(h.frames.at(-1)).toBe(1)
    expect(h.browser.state.error).toBeUndefined()
    h.browser.dispose()
  })

  test("Poll_LeavesRoomForUserActions_WithinTheServerRateLimit", () => {
    expect(browserPollRequestsPerMinute()).toBeLessThan(SERVER_REQUESTS_PER_MINUTE * 0.75)
  })

  test("SecondarySync_RunsOnTheFirstTickThenOnlyEveryFew", () => {
    expect([0, 1, 2, 3, 4, 5].map(isSecondarySyncTick)).toEqual([true, false, false, false, false, true])
  })
})
