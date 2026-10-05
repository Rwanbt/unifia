/* SPDX-License-Identifier: MIT */

import { createStore } from "solid-js/store"
import type { BrowserActivityEvent, BrowserDownload, BrowserSession, BrowserTab, BrowserViewportInput, P3Capability } from "@unifia/contracts"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import { normalizeBrowserAddress, rememberVisited, shouldSyncBrowserAddress, type BrowserHistoryAction, type BrowserNavigationRequest } from "@/pages/workbench/design-browser-model"
import { applyBrowserNavigationRequest, browserLocalStore, resolveBrowserSession, type BrowserSessionStore } from "@/pages/workbench/browser-session-resolve"

// Below the screenshot round trip a faster poll only queues requests; above ~1 s typing feels laggy.
const SYNC_INTERVAL_MS = 900
// Keeps the activity strip and the execution inspector bounded on long sessions.
const ACTIVITY_LIMIT = 100

export type BrowserUpload = { name: string; mediaType: string; base64: string }

export type BrowserSurfaceState = {
  session: BrowserSession | undefined
  address: string
  frame: string
  activity: readonly BrowserActivityEvent[]
  downloads: readonly BrowserDownload[]
  releaseApproval: { downloadId: string; approvalId: string } | undefined
  uploadApproval: { approvalId: string; upload: BrowserUpload } | undefined
  visited: readonly string[]
  error: string | undefined
  loading: boolean
}

export type BrowserSessionDeps = {
  browserConnection: () => WorkbenchConnection | undefined
  ensureBrowserConnected: () => Promise<WorkbenchConnection>
  /** Mirrors the activity feed into the execution inspector. */
  publishActivity: (events: readonly BrowserActivityEvent[]) => void
  store?: BrowserSessionStore
}

const initialState = (): BrowserSurfaceState => ({
  session: undefined,
  address: "",
  frame: "",
  activity: [],
  downloads: [],
  releaseApproval: undefined,
  uploadApproval: undefined,
  visited: [],
  error: undefined,
  loading: true,
})

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))

/** Owns one chat-linked Browser session for the surface: loading, polling and every user action. */
export function createBrowserSessionController(deps: BrowserSessionDeps) {
  const [state, setState] = createStore<BrowserSurfaceState>(initialState())
  const store = deps.store ?? browserLocalStore
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let generation = 0
  let synchronizing = false
  let activitySequence = 0
  let displayedAddress: { tabId?: string; url?: string } = {}
  let appliedRequest = ""

  const activeTab = (): BrowserTab | undefined => state.session?.tabs.find((tab) => tab.id === state.session?.activeTabId)
  const isCurrent = (session: BrowserSession) => !disposed && state.session?.id === session.id
  const fail = (reason: unknown) => {
    if (!disposed) setState("error", message(reason))
  }
  const stopPolling = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  const remember = (session: BrowserSession) => {
    setState("session", session)
    const tab = session.tabs.find((item) => item.id === session.activeTabId)
    if (!tab) setState("frame", "")
    const next = { tabId: tab?.id, url: tab?.url }
    if (!shouldSyncBrowserAddress(displayedAddress, next)) return
    displayedAddress = next
    setState("address", tab?.url ?? "")
    const page = tab?.url ? normalizeBrowserAddress(tab.url) : ""
    if (page) setState("visited", (pages) => rememberVisited(pages, page))
  }

  const appendActivity = (events: readonly BrowserActivityEvent[]) => {
    if (!events.length) return
    activitySequence = events.at(-1)!.sequence
    const next = [...state.activity, ...events].slice(-ACTIVITY_LIMIT)
    setState("activity", next)
    deps.publishActivity(next)
  }

  const syncActiveTab = async (connection: WorkbenchConnection, session: BrowserSession) => {
    const tab = activeTab()
    if (!tab) return
    const current = await connection.client.getBrowserTabState(connection.workspaceId, session.id, tab.id)
    if (!isCurrent(session) || state.session?.activeTabId !== tab.id) return
    remember(current.session)
    const frame = await connection.client.screenshotBrowserTab(connection.workspaceId, session.id, tab.id)
    if (isCurrent(session) && state.session?.activeTabId === tab.id) setState("frame", `data:${frame.contentType};base64,${frame.data}`)
  }

  const sync = async () => {
    const session = state.session
    const connection = deps.browserConnection()
    if (!session || !connection || disposed || synchronizing) return
    synchronizing = true
    try {
      await syncActiveTab(connection, session)
      if (!isCurrent(session)) return
      appendActivity((await connection.client.browserActivity(connection.workspaceId, session.id, activitySequence)).events)
      const files = await connection.client.browserDownloads(connection.workspaceId, session.id)
      if (isCurrent(session)) setState("downloads", files.downloads)
    } catch (reason) {
      fail(reason)
    } finally {
      synchronizing = false
    }
  }

  /** (Re)binds the surface to the Browser session of this directory and chat. */
  const load = (input: { directory: string | undefined; chatSessionId: string | undefined; request: BrowserNavigationRequest | undefined }) => {
    const current = ++generation
    stopPolling()
    setState(initialState())
    deps.publishActivity([])
    activitySequence = 0
    displayedAddress = {}
    void (async () => {
      try {
        const connection = await deps.ensureBrowserConnected()
        if (disposed || current !== generation || !input.directory) return
        const resolved = await resolveBrowserSession({ connection, chatSessionId: input.chatSessionId, store })
        const applied = await applyBrowserNavigationRequest({ connection, session: resolved, request: input.request, applied: appliedRequest })
        if (disposed || current !== generation) return
        appliedRequest = applied.applied
        remember(applied.session)
        setState({ error: undefined, loading: false })
        await sync()
        if (!disposed && current === generation) timer = setInterval(() => void sync(), SYNC_INTERVAL_MS)
      } catch (reason) {
        if (disposed || current !== generation) return
        setState({ error: message(reason), loading: false })
      }
    })()
  }

  const dispose = () => {
    disposed = true
    generation += 1
    stopPolling()
  }

  type Operation = (connection: WorkbenchConnection, session: BrowserSession, tab: BrowserTab | undefined) => Promise<BrowserSession | void>
  /** Runs one user action against the live session and refreshes the view after it. */
  const act = async (operation: Operation, needsTab = true) => {
    const session = state.session
    const tab = activeTab()
    if (!session || (needsTab && !tab)) return
    try {
      const connection = await deps.ensureBrowserConnected()
      const updated = await operation(connection, session, tab)
      if (updated) remember(updated)
      setState("error", undefined)
      void sync()
    } catch (reason) {
      fail(reason)
    }
  }

  const navigate = (raw: string, invalidAddress: string) => {
    const url = normalizeBrowserAddress(raw)
    if (!url) return setState("error", invalidAddress)
    void act((c, s, tab) => c.client.navigateBrowserTab(c.workspaceId, s.id, tab!.id, url).then((r) => r.session))
  }
  const openTab = () => void act((c, s) => c.client.openBrowserTab(c.workspaceId, s.id).then((r) => r.session), false)
  const chooseTab = (tabId: string) => void act((c, s) => c.client.selectBrowserTab(c.workspaceId, s.id, tabId).then((r) => r.session))
  const closeTab = (tabId: string) => void act((c, s) => c.client.closeBrowserTab(c.workspaceId, s.id, tabId).then((r) => r.session))
  const history = (action: BrowserHistoryAction) => void act((c, s, tab) => c.client.browserTabHistory(c.workspaceId, s.id, tab!.id, action).then((r) => r.session))
  const resizeViewport = (viewport: BrowserSession["viewport"]) =>
    void act((c, s) => c.client.resizeBrowserViewport(c.workspaceId, s.id, viewport).then((r) => r.session))
  const setController = (controller: "user" | "ai") =>
    void act((c, s) => c.client.setBrowserController(c.workspaceId, s.id, controller).then((r) => r.session))

  const refreshDownloads = async (connection: WorkbenchConnection, session: BrowserSession) =>
    setState("downloads", (await connection.client.browserDownloads(connection.workspaceId, session.id)).downloads)

  const requestDownloadRelease = (downloadId: string) =>
    void act(async (c, s) => {
      const result = await c.client.releaseBrowserDownload(c.workspaceId, s.id, downloadId)
      if ("approvalRequired" in result) return void setState("releaseApproval", { downloadId, approvalId: result.approvalId })
      setState("releaseApproval", undefined)
      await refreshDownloads(c, s)
    }, false)

  const approveDownloadRelease = () => {
    const approval = state.releaseApproval
    if (!approval) return
    void act(async (c, s) => {
      await c.client.resolveApproval(approval.approvalId, "allow")
      const result = await c.client.releaseBrowserDownload(c.workspaceId, s.id, approval.downloadId)
      if ("approvalRequired" in result) throw new Error("Browser download approval is still pending")
      setState("releaseApproval", undefined)
      await refreshDownloads(c, s)
    }, false)
  }

  const userControls = () => state.session?.controller === "user"

  /** Uploads a user-chosen file to the active page; a missing grant turns into an approval request. */
  const upload = (file: BrowserUpload) => {
    if (!userControls()) return
    void act(async (c, s, tab) => {
      const result = await c.client.uploadBrowserFile(c.workspaceId, s.id, tab!.id, file)
      setState("uploadApproval", "approvalRequired" in result ? { approvalId: result.approvalId, upload: file } : undefined)
    })
  }

  const approveUpload = () => {
    const approval = state.uploadApproval
    if (!approval) return
    void act(async (c, s, tab) => {
      await c.client.resolveApproval(approval.approvalId, "allow")
      const result = await c.client.uploadBrowserFile(c.workspaceId, s.id, tab!.id, approval.upload)
      if ("approvalRequired" in result) throw new Error("Browser upload approval is still pending")
      setState("uploadApproval", undefined)
    })
  }

  /** Forwards pointer, key and wheel input; only the user may drive the page directly. */
  const sendInput = async (input: BrowserViewportInput) => {
    const session = state.session
    const tab = activeTab()
    const connection = deps.browserConnection()
    if (!session || !tab || !connection || session.controller !== "user") return
    try {
      await connection.client.inputBrowserTab(connection.workspaceId, session.id, tab.id, input)
    } catch (reason) {
      fail(reason)
    }
  }

  const grantedCapabilities = (): readonly P3Capability[] => {
    const connection = deps.browserConnection()
    if (!connection) return []
    return [...connection.grants].filter((capability): capability is P3Capability => capability.startsWith("browser."))
  }

  return {
    state,
    activeTab,
    userControls,
    grantedCapabilities,
    setAddress: (value: string) => setState("address", value),
    setError: (value: string | undefined) => setState("error", value),
    load,
    dispose,
    navigate,
    openTab,
    chooseTab,
    closeTab,
    history,
    resizeViewport,
    setController,
    requestDownloadRelease,
    approveDownloadRelease,
    upload,
    approveUpload,
    sendInput,
  }
}

export type BrowserSessionController = ReturnType<typeof createBrowserSessionController>
