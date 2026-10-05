/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { BrowserObservationSchema, BrowserSessionSchema, BrowserViewportSchema, MAX_BROWSER_UPLOAD_BYTES, type BrowserActivityEvent, type BrowserActivityKind, type BrowserDownload, type BrowserHistoryAction, type BrowserInteractionAction, type BrowserController, type BrowserObservation, type BrowserSession, type BrowserTab, type BrowserRuntimeProfile, type BrowserViewport, type BrowserViewportInput } from "@unifia/contracts/browser"
import type { P3Capability } from "@unifia/contracts"
import { approvedNavigationOrigin, assertHttpNavigationDestination, navigationApprovalReason } from "./navigation-approval.ts"

const MAX_ACTIVITY_EVENTS_PER_SESSION = 500

export type BrowserPagePort = {
  open(session: BrowserSession, tabId: string, onDownload?: (download: BrowserDownload) => void, onDownloadFailure?: (error: unknown, tabId: string) => void, onPopup?: BrowserPopupHandler, onNavigationBlocked?: (reason: "external protocol" | "navigation origin approval") => void): Promise<void>
  close(session: BrowserSession, tab: BrowserTab): Promise<void>
  closeSession?(session: BrowserSession, preserveStorage?: boolean): Promise<void>
  shutdown?(): Promise<void>
  navigate(session: BrowserSession, tabId: string, url: string, approvedOrigin?: string): Promise<Pick<BrowserTab, "url" | "origin" | "title" | "faviconUrl" | "loading" | "canGoBack" | "canGoForward" | "status">>
  authorizeOrigin?(sessionId: string, url: string): void
  setController?(sessionId: string, controller: BrowserController): void
  setNetworkBlockedHandler?(handler: (sessionId: string, reason: BrowserNetworkBlockReason) => void): void
  history?(session: BrowserSession, tabId: string, action: BrowserHistoryAction): Promise<Pick<BrowserTab, "url" | "origin" | "title" | "faviconUrl" | "loading" | "canGoBack" | "canGoForward" | "status">>
  resizeViewport?(session: BrowserSession, viewport: BrowserViewport): Promise<void>
  state?(session: BrowserSession, tabId: string): Promise<Pick<BrowserTab, "url" | "origin" | "title" | "faviconUrl" | "loading" | "canGoBack" | "canGoForward" | "status">>
  select(session: BrowserSession, tabId: string): Promise<void>
  observe(session: BrowserSession, tabId: string): Promise<{ url: string; origin: string | null; modelText: string }>
  actionApprovalRequirement?(session: BrowserSession, tabId: string, action: BrowserInteractionAction): Promise<string | undefined>
  act(session: BrowserSession, tabId: string, action: BrowserInteractionAction, expected: BrowserObservation, signal: AbortSignal, approvalReason?: string): Promise<boolean>
  input?(session: BrowserSession, tabId: string, action: BrowserViewportInput): Promise<void>
  upload?(session: BrowserSession, tabId: string, file: { name: string; mediaType: string; bytes: Uint8Array }): Promise<void>
  screenshot?(session: BrowserSession, tabId: string): Promise<Uint8Array>
  downloads?(sessionId: string): readonly BrowserDownload[]
  releaseDownload?(session: BrowserSession, downloadId: string): Promise<BrowserDownload>
}

export type BrowserNetworkBlockReason = "invalid-url" | "origin-denied" | "dns-failed" | "address-denied" | "policy-invalid"

export type BrowserPopupHandler = (url: string, openerTabId: string, attach: (tabId: string) => void, originApproved: boolean) => boolean

export type BrowserSessionServiceOptions = {
  pages: BrowserPagePort
  createId: () => string
  now?: () => number
  authorizeNavigation: (workspaceId: string, url: string) => Promise<void>
  snapshots?: BrowserSessionSnapshotStore
}

export type BrowserSessionSnapshotStore = {
  load(): readonly BrowserSession[]
  save(session: BrowserSession): void
  close(): void
}

export class BrowserActionApprovalRequiredError extends Error {
  constructor() {
    super("This Browser action requires user approval")
    this.name = "BrowserActionApprovalRequiredError"
  }
}

/** Owns browser state independently of the UI component lifetime. */
export class BrowserSessionService {
  readonly #pages: BrowserPagePort
  readonly #createId: () => string
  readonly #now: () => number
  readonly #authorizeNavigation: BrowserSessionServiceOptions["authorizeNavigation"]
  readonly #snapshots: BrowserSessionSnapshotStore | undefined
  readonly #sessions = new Map<string, BrowserSession>()
  readonly #restored = new Set<string>()
  readonly #hydrating = new Map<string, Promise<void>>()
  readonly #observations = new Map<string, BrowserObservation>()
  readonly #inFlight = new Map<string, { controller: AbortController; settled: Promise<void> }>()
  readonly #pendingApprovals = new Map<string, { tabId: string; actionKind: BrowserInteractionAction["kind"] }>()
  readonly #controlTransitions = new Set<string>()
  readonly #activity = new Map<string, BrowserActivityEvent[]>()
  readonly #sessionCapabilities = new Map<string, readonly P3Capability[]>()

  constructor(options: BrowserSessionServiceOptions) {
    this.#pages = options.pages
    this.#createId = options.createId
    this.#now = options.now ?? Date.now
    this.#authorizeNavigation = options.authorizeNavigation
    this.#snapshots = options.snapshots
    for (const value of options.snapshots?.load() ?? []) {
      const session = BrowserSessionSchema.parse(value)
      if (session.status === "closed") continue
      const restored = BrowserSessionSchema.parse({ ...session, controller: "user", status: "ready", tabs: session.tabs.map((tab) => ({ ...tab, loading: false, status: "ready" })) })
      if (this.#sessions.has(restored.id)) throw new Error("duplicate restored browser session")
      this.#sessions.set(restored.id, restored)
      this.#restored.add(restored.id)
    }
    this.#pages.setNetworkBlockedHandler?.((sessionId, reason) => {
      const session = this.#sessions.get(sessionId)
      if (!session || session.status === "closed") return
      this.#record(sessionId, "network.blocked", session.controller, session.activeTabId ?? undefined, reason)
    })
  }

  create(input: { workspaceId: string; chatSessionId?: string; runtimeProfile: BrowserRuntimeProfile; viewport: BrowserViewport; capabilities?: readonly P3Capability[] }): BrowserSession {
    const existing = input.chatSessionId
      ? [...this.#sessions.values()].find((session) => session.workspaceId === input.workspaceId && session.chatSessionId === input.chatSessionId && session.status !== "closed")
      : undefined
    if (existing) return existing
    const now = this.#now()
    const session = BrowserSessionSchema.parse({
      id: this.#createId(), workspaceId: input.workspaceId, chatSessionId: input.chatSessionId,
      profileId: this.#createId(), runtimeProfile: input.runtimeProfile, controller: "user" as const,
      tabs: [], activeTabId: null, viewport: input.viewport, status: "ready" as const, createdAt: now, updatedAt: now,
    })
    this.#snapshots?.save(session)
    this.#sessions.set(session.id, session)
    this.#sessionCapabilities.set(session.id, [...new Set(input.capabilities ?? [])])
    this.#record(session.id, "session.created", session.controller)
    return session
  }

  get(sessionId: string): BrowserSession {
    const session = this.#sessions.get(sessionId)
    if (!session || session.status === "closed") throw new Error("browser session is unavailable")
    return session
  }

  forChatSession(workspaceId: string, chatSessionId: string): { sessionId: string; capabilities: readonly P3Capability[] } | undefined {
    const session = [...this.#sessions.values()]
      .filter((item) => item.workspaceId === workspaceId && item.chatSessionId === chatSessionId && item.status !== "closed")
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (!session) return undefined
    return { sessionId: session.id, capabilities: this.#sessionCapabilities.get(session.id) ?? [] }
  }

  bindCapabilities(sessionId: string, capabilities: readonly P3Capability[]): void {
    this.get(sessionId)
    this.#sessionCapabilities.set(sessionId, [...new Set(capabilities)])
  }

  async openTab(sessionId: string, url = "about:blank"): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    if (current.controller !== "user") throw new Error("user does not control this browser session")
    await this.#cancelActions(sessionId)
    const tabId = this.#createId()
    const initial = emptyTab(tabId, url)
    const opening = this.#save(update(current, { tabs: [...current.tabs, initial], activeTabId: tabId, status: "starting" }))
    this.#invalidate(sessionId)
    try {
      await this.#openPage(opening, tabId)
      this.#record(sessionId, "tab.opened", opening.controller, tabId)
      const ready = url === "about:blank" ? initial : await this.#navigate(opening, tabId, url)
      const latest = this.get(sessionId)
      return this.#save(update(latest, { tabs: latest.tabs.map((tab) => tab.id === tabId ? ready : tab), status: "ready" }))
    } catch (error) {
      const latest = this.get(sessionId)
      this.#save(update(latest, { tabs: latest.tabs.map((tab) => tab.id === tabId ? { ...initial, status: "error" } : tab), status: "error" }))
      throw error
    }
  }

  async navigate(sessionId: string, tabId: string, url: string, controller: "user" | "ai", approvedOrigin?: string): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    if (current.controller !== controller) throw new Error(`${controller} does not control this browser session`)
    requireTab(current, tabId)
    if (current.activeTabId !== tabId) throw new Error("browser tab is not active")
    await this.#cancelActions(sessionId)
    const next = await this.#navigate(current, tabId, url, approvedOrigin)
    this.#invalidate(sessionId)
    return this.#save(update(current, { tabs: current.tabs.map((tab) => tab.id === tabId ? next : tab) }))
  }

  async history(sessionId: string, tabId: string, action: BrowserHistoryAction): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    requireTab(current, tabId)
    if (current.controller !== "user") throw new Error("user does not control this browser session")
    if (current.activeTabId !== tabId) throw new Error("browser tab is not active")
    if (!this.#pages.history) throw new Error("browser history is unavailable")
    await this.#cancelActions(sessionId)
    const changed = await this.#pages.history(current, tabId, action)
    this.#invalidate(sessionId)
    return this.#save(update(current, { tabs: current.tabs.map((tab) => tab.id === tabId ? { ...tab, ...changed } : tab) }))
  }

  async resizeViewport(sessionId: string, viewportInput: BrowserViewport): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    if (current.controller !== "user") throw new Error("user does not control this browser session")
    const viewport = BrowserViewportSchema.parse(viewportInput)
    if (!this.#pages.resizeViewport) throw new Error("browser viewport resize is unavailable")
    await this.#cancelActions(sessionId)
    await this.#pages.resizeViewport(current, viewport)
    this.#invalidate(sessionId)
    const updated = this.#save(update(current, { viewport }))
    this.#record(sessionId, "viewport.changed", updated.controller, updated.activeTabId ?? undefined, `${viewport.width}x${viewport.height}`)
    return updated
  }

  async refreshTab(sessionId: string, tabId: string): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    const tab = requireTab(current, tabId)
    if (!this.#pages.state) return current
    const state = await this.#pages.state(current, tabId)
    const latest = this.get(sessionId)
    const latestTab = latest.tabs.find((item) => item.id === tabId)
    if (latestTab?.pageId !== tab.pageId) throw new Error("browser tab changed while reading page state")
    if (Object.entries(state).every(([key, value]) => latestTab[key as keyof BrowserTab] === value)) return latest
    return this.#save(update(latest, { tabs: latest.tabs.map((item) => item.id === tabId ? { ...item, ...state } : item) }))
  }

  async selectTab(sessionId: string, tabId: string): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    if (current.controller !== "user") throw new Error("user does not control this browser session")
    requireTab(current, tabId)
    await this.#cancelActions(sessionId)
    await this.#pages.select(current, tabId)
    this.#invalidate(sessionId)
    const updated = this.#save(update(current, { activeTabId: tabId }))
    this.#record(sessionId, "tab.selected", updated.controller, tabId)
    return updated
  }

  async closeTab(sessionId: string, tabId: string): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    if (current.controller !== "user") throw new Error("user does not control this browser session")
    const tab = requireTab(current, tabId)
    await this.#cancelActions(sessionId)
    const tabs = current.tabs.filter((item) => item.id !== tabId)
    const activeTabId = current.activeTabId === tabId ? tabs.at(-1)?.id ?? null : current.activeTabId
    await this.#pages.close(current, tab)
    this.#record(sessionId, "tab.closed", current.controller, tabId)
    if (activeTabId && activeTabId !== current.activeTabId) await this.#pages.select(current, activeTabId)
    this.#invalidate(sessionId)
    return this.#save(update(current, { tabs, activeTabId }))
  }

  async close(sessionId: string): Promise<void> {
    const pending = this.#hydrating.get(sessionId)
    if (pending) await pending.catch(() => {
      process.emitWarning("Browser session recovery failed before close", { code: "BROWSER_RECOVERY_FAILED" })
    })
    const current = this.get(sessionId)
    await this.#cancelActions(sessionId)
    for (const tab of current.tabs) await this.#pages.close(current, tab)
    await this.#pages.closeSession?.(current)
    this.#invalidate(sessionId)
    this.#save(update(current, { tabs: [], activeTabId: null, status: "closed" }))
    this.#restored.delete(sessionId)
    this.#sessionCapabilities.delete(sessionId)
    this.#record(sessionId, "session.closed", current.controller)
  }

  async shutdown(): Promise<void> {
    const failures: unknown[] = []
    const recovery = await Promise.allSettled([...this.#hydrating.values()])
    for (const result of recovery) if (result.status === "rejected") failures.push(result.reason)
    const active = [...this.#sessions.values()].filter((session) => session.status !== "closed")
    for (const session of active) {
      try {
        await this.#cancelActions(session.id)
        for (const tab of session.tabs) await this.#pages.close(session, tab)
        await this.#pages.closeSession?.(session, true)
      } catch (error) { failures.push(error) }
    }
    try { await this.#pages.shutdown?.() } catch (error) { failures.push(error) }
    try { this.#snapshots?.close() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, "browser session shutdown failed")
  }

  async observe(sessionId: string, tabId: string): Promise<{ receipt: BrowserObservation; modelText: string }> {
    await this.#hydrate(sessionId)
    const session = this.get(sessionId)
    requireTab(session, tabId)
    if (session.controller === "paused") throw new Error("browser control is paused")
    const page = await this.#pages.observe(session, tabId)
    const receipt = BrowserObservationSchema.parse({
      id: this.#createId(), sessionId, tabId, pageId: requireTab(session, tabId).pageId,
      url: page.url, origin: page.origin,
      stateDigest: createHash("sha256").update(`${page.url}\n${page.origin ?? ""}\n${page.modelText}`).digest("hex"),
      capturedAt: this.#now(),
    })
    this.#invalidateTab(sessionId, tabId)
    this.#observations.set(receipt.id, receipt)
    this.#record(sessionId, "page.observed", session.controller, tabId)
    return { receipt, modelText: page.modelText }
  }

  async act(sessionId: string, tabId: string, observationId: string, action: BrowserInteractionAction, approveSensitiveAction?: (reason: string) => Promise<void>): Promise<void> {
    return this.#act(sessionId, tabId, observationId, action, approveSensitiveAction)
  }

  async #act(
    sessionId: string,
    tabId: string,
    observationId: string,
    action: BrowserInteractionAction,
    approveSensitiveAction?: (reason: string) => Promise<void>,
  ): Promise<void> {
    await this.#hydrate(sessionId)
    const session = this.get(sessionId)
    if (this.#controlTransitions.has(sessionId)) throw new Error("browser control is changing")
    if (session.controller !== "ai") throw new Error("AI does not control this browser session")
    if (session.activeTabId !== tabId) throw new Error("browser tab is not active")
    if (this.#inFlight.has(sessionId)) throw new Error("browser action is already running")
    const controller = new AbortController()
    let finish!: () => void
    const settled = new Promise<void>((resolve) => { finish = resolve })
    this.#inFlight.set(sessionId, { controller, settled })
    try {
      await this.#performAction(sessionId, tabId, observationId, action, approveSensitiveAction, controller.signal)
    } finally {
      if (this.#inFlight.get(sessionId)?.controller === controller) this.#inFlight.delete(sessionId)
      finish()
    }
  }

  async #performAction(
    sessionId: string,
    tabId: string,
    observationId: string,
    action: BrowserInteractionAction,
    approveSensitiveAction: ((reason: string) => Promise<void>) | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    let actionStarted = false
    const receipt = this.#observations.get(observationId)
    if (!receipt || receipt.sessionId !== sessionId || receipt.tabId !== tabId) throw new Error("STALE_OBSERVATION")
    try {
      let session = this.get(sessionId)
      await waitWithAbort(this.#assertFreshObservation(session, tabId, observationId, receipt), signal)
      const approvalReason = await waitWithAbort(
        Promise.resolve(this.#pages.actionApprovalRequirement?.(session, tabId, action)),
        signal,
      )
      if (approvalReason) {
        await this.#approveSensitiveAction(session, tabId, observationId, receipt, action, approvalReason, approveSensitiveAction, signal)
      } else await waitWithAbort(this.#assertFreshObservation(session, tabId, observationId, receipt), signal)
      session = this.get(sessionId)
      if (this.#controlTransitions.has(sessionId) || session.controller !== "ai" || session.activeTabId !== tabId) {
        throw new Error("browser control changed")
      }
      signal.throwIfAborted()
      this.#observations.delete(observationId)
      this.#record(sessionId, "action.started", session.controller, tabId, action.kind)
      actionStarted = true
      try {
        if (!await this.#pages.act(session, tabId, action, receipt, signal, approvalReason)) throw new Error("STALE_OBSERVATION")
        this.#invalidate(sessionId)
        this.#record(sessionId, "action.completed", session.controller, tabId, action.kind)
      } catch (error) {
        if (signal.aborted) this.#record(sessionId, "action.cancelled", this.get(sessionId).controller, tabId, action.kind)
        else this.#record(sessionId, "action.failed", this.get(sessionId).controller, tabId, action.kind)
        throw error
      }
    } catch (error) {
      if (!actionStarted) {
        const controller = this.get(sessionId).controller
        if (signal.aborted) this.#record(sessionId, "action.cancelled", controller, tabId, action.kind)
        else if (error instanceof Error && error.message === "external browser protocols are blocked") {
          this.#record(sessionId, "navigation.blocked", controller, tabId, "external protocol")
        }
      }
      throw error
    }
  }

  async #approveSensitiveAction(
    session: BrowserSession,
    tabId: string,
    observationId: string,
    receipt: BrowserObservation,
    action: BrowserInteractionAction,
    approvalReason: string,
    approveSensitiveAction: ((reason: string) => Promise<void>) | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const { id: sessionId } = session
    if (approvalReason) {
      this.#record(sessionId, "action.approval_required", session.controller, tabId, action.kind)
      if (!approveSensitiveAction) {
        this.#observations.delete(observationId)
        this.#record(sessionId, "action.approval_unavailable", session.controller, tabId, action.kind)
        throw new BrowserActionApprovalRequiredError()
      }
      if (this.#pendingApprovals.has(sessionId)) throw new Error("browser approval is already pending")
      this.#pendingApprovals.set(sessionId, { tabId, actionKind: action.kind })
      try {
        await waitWithAbort(approveSensitiveAction(approvalReason), signal)
      } catch (error) {
        this.#observations.delete(observationId)
        if (!signal.aborted && !this.#controlTransitions.has(sessionId) && this.get(sessionId).controller === "ai") {
          this.#record(sessionId, "action.approval_denied", this.get(sessionId).controller, tabId, action.kind)
        }
        throw error
      } finally {
        this.#pendingApprovals.delete(sessionId)
      }
      signal.throwIfAborted()
      if (this.#controlTransitions.has(sessionId) || this.get(sessionId).controller !== "ai") throw new Error("browser control changed")
      try {
        await waitWithAbort(this.#assertFreshObservation(this.get(sessionId), tabId, observationId, receipt), signal)
      } catch (error) {
        const latest = this.get(sessionId)
        if (!signal.aborted && latest.controller === "ai") this.#record(sessionId, "action.approval_cancelled", latest.controller, tabId, "stale observation")
        throw error
      }
      session = this.get(sessionId)
      const updatedReason = await waitWithAbort(
        Promise.resolve(this.#pages.actionApprovalRequirement?.(session, tabId, action)),
        signal,
      )
      if (!updatedReason || updatedReason !== approvalReason) {
        this.#observations.delete(observationId)
        this.#record(sessionId, "action.approval_cancelled", session.controller, tabId, "action changed")
        throw new Error("STALE_OBSERVATION")
      }
    }
  }

  async actionApprovalRequirement(sessionId: string, tabId: string, observationId: string, action: BrowserInteractionAction): Promise<string | undefined> {
    await this.#hydrate(sessionId)
    const session = this.get(sessionId)
    if (session.controller !== "ai" || session.activeTabId !== tabId || this.#controlTransitions.has(sessionId)) {
      throw new Error("AI does not control the active Browser tab")
    }
    const receipt = this.#observations.get(observationId)
    if (!receipt || receipt.sessionId !== sessionId || receipt.tabId !== tabId) throw new Error("STALE_OBSERVATION")
    await this.#assertFreshObservation(session, tabId, observationId, receipt)
    return this.#pages.actionApprovalRequirement?.(session, tabId, action)
  }

  async #assertFreshObservation(session: BrowserSession, tabId: string, observationId: string, receipt: BrowserObservation): Promise<void> {
    const page = await this.#pages.observe(session, tabId)
    const current = this.get(session.id)
    const digest = createHash("sha256").update(`${page.url}\n${page.origin ?? ""}\n${page.modelText}`).digest("hex")
    if (current.controller !== "ai" || current.activeTabId !== tabId || receipt.pageId !== requireTab(current, tabId).pageId ||
      receipt.url !== page.url || receipt.origin !== page.origin || receipt.stateDigest !== digest) {
      this.#observations.delete(observationId)
      throw new Error("STALE_OBSERVATION")
    }
  }

  async input(sessionId: string, tabId: string, action: BrowserViewportInput): Promise<void> {
    await this.#hydrate(sessionId)
    const session = this.get(sessionId)
    if (session.controller !== "user") throw new Error("user does not control this browser session")
    if (session.activeTabId !== tabId) throw new Error("browser tab is not active")
    if (!this.#pages.input) throw new Error("browser viewport input is unavailable")
    await this.#cancelActions(sessionId)
    await this.#pages.input(session, tabId, action)
    this.#invalidate(sessionId)
    this.#record(sessionId, "user.input", session.controller, tabId, action.kind)
  }

  async upload(sessionId: string, tabId: string, file: { name: string; mediaType: string; bytes: Uint8Array }): Promise<void> {
    await this.#hydrate(sessionId)
    const session = this.get(sessionId)
    if (session.controller !== "user") throw new Error("user does not control this browser session")
    if (session.activeTabId !== tabId) throw new Error("browser tab is not active")
    if (!this.#sessionCapabilities.get(sessionId)?.includes("browser.upload")) throw new Error("browser upload capability is unavailable")
    if (!this.#pages.upload) throw new Error("browser file upload is unavailable")
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_BROWSER_UPLOAD_BYTES) throw new Error("browser upload size is outside the allowed range")
    if (!file.name || file.name.length > 255 || /[\\/\0]/.test(file.name) || file.name === "." || file.name === "..") throw new Error("browser upload filename is invalid")
    if (!file.mediaType || file.mediaType.length > 128) throw new Error("browser upload media type is invalid")
    await this.#cancelActions(sessionId)
    await this.#pages.upload(session, tabId, file)
    this.#invalidate(sessionId)
    this.#record(sessionId, "user.upload", session.controller, tabId, "selected file")
  }

  async screenshot(sessionId: string, tabId: string): Promise<Uint8Array> {
    await this.#hydrate(sessionId)
    const session = this.get(sessionId)
    requireTab(session, tabId)
    if (!this.#pages.screenshot) throw new Error("browser viewport screenshot is unavailable")
    return this.#pages.screenshot(session, tabId)
  }

  downloads(sessionId: string): readonly BrowserDownload[] {
    this.get(sessionId)
    return this.#pages.downloads?.(sessionId) ?? []
  }

  async releaseDownload(sessionId: string, downloadId: string): Promise<BrowserDownload> {
    const session = this.get(sessionId)
    if (session.controller !== "user") throw new Error("user control is required to release a Browser download")
    if (!this.#pages.releaseDownload) throw new Error("browser download release is unavailable")
    const download = await this.#pages.releaseDownload(session, downloadId)
    this.#record(sessionId, "download.released", session.controller)
    return download
  }

  async takeControl(sessionId: string, controller: BrowserController): Promise<BrowserSession> {
    await this.#hydrate(sessionId)
    const current = this.get(sessionId)
    if (current.controller === controller) return current
    if (this.#controlTransitions.has(sessionId)) throw new Error("browser control transition is already running")
    this.#controlTransitions.add(sessionId)
    try {
      const pendingApproval = this.#pendingApprovals.get(sessionId)
      if (pendingApproval) {
        this.#pendingApprovals.delete(sessionId)
        this.#record(sessionId, "action.approval_cancelled", current.controller, pendingApproval.tabId, pendingApproval.actionKind)
      }
      await this.#cancelActions(sessionId)
      const latest = this.get(sessionId)
      if (latest.controller === controller) return latest
      this.#pages.setController?.(sessionId, controller)
      this.#invalidate(sessionId)
      const updated = this.#save(update(latest, { controller }))
      this.#record(sessionId, "controller.changed", controller)
      return updated
    } finally {
      this.#controlTransitions.delete(sessionId)
    }
  }

  activity(sessionId: string, after = 0): readonly BrowserActivityEvent[] {
    this.get(sessionId)
    return (this.#activity.get(sessionId) ?? []).filter((event) => event.sequence > after)
  }

  async #hydrate(sessionId: string): Promise<void> {
    if (!this.#restored.has(sessionId)) return
    const running = this.#hydrating.get(sessionId)
    if (running) return running
    const task = this.#restorePages(sessionId)
    this.#hydrating.set(sessionId, task)
    try { await task }
    finally { if (this.#hydrating.get(sessionId) === task) this.#hydrating.delete(sessionId) }
  }

  async #restorePages(sessionId: string): Promise<void> {
    const session = this.get(sessionId)
    const opened: BrowserTab[] = []
    const refreshed = new Map<string, BrowserTab>()
    try {
      for (const tab of session.tabs) {
        await this.#openPage(session, tab.id)
        opened.push(tab)
        if (tab.url === "about:blank") continue
        try {
          await this.#authorizeNavigation(session.workspaceId, tab.url)
          this.#pages.authorizeOrigin?.(sessionId, tab.url)
          refreshed.set(tab.id, { ...tab, ...await this.#pages.navigate(session, tab.id, tab.url) })
        } catch {
          refreshed.set(tab.id, { ...tab, loading: false, status: "error" })
          this.#record(sessionId, "navigation.blocked", session.controller, tab.id, "restore failed")
        }
      }
      if (session.activeTabId) await this.#pages.select(session, session.activeTabId)
      const latest = this.get(sessionId)
      this.#save(update(latest, { tabs: latest.tabs.map((tab) => refreshed.get(tab.id) ?? tab), status: "ready" }))
      this.#restored.delete(sessionId)
    } catch (error) {
      const cleanup = await Promise.allSettled(opened.map((tab) => this.#pages.close(session, tab)))
      try { await this.#pages.closeSession?.(session) } catch (failure) { cleanup.push({ status: "rejected", reason: failure }) }
      const failures = cleanup.filter((result) => result.status === "rejected")
      if (failures.length) throw new AggregateError([error, ...failures.map((result) => result.reason)], "browser session recovery cleanup failed")
      throw error
    }
  }

  async #openPage(session: BrowserSession, tabId: string): Promise<void> {
    const sessionId = session.id
    await this.#pages.open(
      session,
      tabId,
      (download) => this.#record(sessionId, "download.quarantined", this.#sessions.get(sessionId)?.controller ?? session.controller, download.tabId),
      (_error, downloadTabId) => this.#record(sessionId, "download.failed", this.#sessions.get(sessionId)?.controller ?? session.controller, downloadTabId),
      (url, openerTabId, attach, originApproved) => {
        const latest = this.#sessions.get(sessionId)
        if (!latest || latest.status === "closed") return false
        const opener = latest.tabs.find((tab) => tab.id === openerTabId)
        const popupOrigin = originOf(url)
        if (latest.controller === "ai" && (!popupOrigin || popupOrigin !== opener?.origin) && !originApproved) {
          this.#record(sessionId, "navigation.blocked", latest.controller, openerTabId, "popup origin approval")
          return false
        }
        const popupTabId = this.#createId()
        this.#save(update(latest, { tabs: [...latest.tabs, emptyTab(popupTabId, url)], activeTabId: popupTabId, status: "ready" }))
        this.#invalidate(sessionId)
        attach(popupTabId)
        this.#record(sessionId, "tab.opened", latest.controller, popupTabId, "popup")
        return true
      },
      (reason) => this.#record(sessionId, "navigation.blocked", this.#sessions.get(sessionId)?.controller ?? session.controller, tabId, reason),
    )
  }

  async #navigate(session: BrowserSession, tabId: string, url: string, approvedOrigin?: string): Promise<BrowserTab> {
    const currentUrl = session.tabs.find((tab) => tab.id === tabId)?.url ?? "about:blank"
    try {
      assertHttpNavigationDestination(currentUrl, url)
    } catch (error) {
      this.#record(session.id, "navigation.blocked", session.controller, tabId, "external protocol")
      throw error
    }
    if (approvedOrigin) {
      const target = new URL(url)
      if (target.origin !== approvedOrigin || new URL(approvedOrigin).origin !== approvedOrigin) throw new Error("approved navigation origin does not match the destination")
    }
    const approvalReason = navigationApprovalReason(currentUrl, url)
    const requiredOrigin = approvedNavigationOrigin(approvalReason)
    if (session.controller === "ai" && requiredOrigin && approvedOrigin !== requiredOrigin) {
      this.#record(session.id, "navigation.blocked", session.controller, tabId, "navigation origin approval")
      throw new BrowserActionApprovalRequiredError()
    }
    if (url !== "about:blank") {
      try {
        await this.#authorizeNavigation(session.workspaceId, url)
      } catch (error) {
        this.#record(session.id, "navigation.blocked", session.controller, tabId, "network policy")
        throw error
      }
      this.#pages.authorizeOrigin?.(session.id, url)
    }
    const tab = { ...emptyTab(tabId, url), ...await this.#pages.navigate(session, tabId, url, approvedOrigin) }
    this.#record(session.id, "tab.navigated", session.controller, tabId)
    return tab
  }

  #record(sessionId: string, kind: BrowserActivityKind, controller: BrowserController, tabId?: string, detail?: string): void {
    const events = this.#activity.get(sessionId) ?? []
    events.push({ sequence: (events.at(-1)?.sequence ?? 0) + 1, sessionId, ...(tabId ? { tabId } : {}), kind, controller, occurredAt: this.#now(), ...(detail ? { detail } : {}) })
    if (events.length > MAX_ACTIVITY_EVENTS_PER_SESSION) events.splice(0, events.length - MAX_ACTIVITY_EVENTS_PER_SESSION)
    this.#activity.set(sessionId, events)
  }

  #save(session: BrowserSession): BrowserSession {
    const saved = BrowserSessionSchema.parse({ ...session, updatedAt: Math.max(this.#now(), session.updatedAt) })
    this.#snapshots?.save(saved)
    this.#sessions.set(session.id, saved)
    return saved
  }

  #invalidate(sessionId: string): void {
    for (const [id, observation] of this.#observations) {
      if (observation.sessionId === sessionId) this.#observations.delete(id)
    }
  }

  async #cancelActions(sessionId: string): Promise<void> {
    const active = this.#inFlight.get(sessionId)
    if (!active) return
    active.controller.abort(new Error("browser session state changed"))
    await active.settled
  }

  #invalidateTab(sessionId: string, tabId: string): void {
    for (const [id, observation] of this.#observations) {
      if (observation.sessionId === sessionId && observation.tabId === tabId) this.#observations.delete(id)
    }
  }
}

function emptyTab(id: string, url: string): BrowserTab {
  return { id, pageId: id, url, origin: originOf(url), title: "", loading: false, canGoBack: false, canGoForward: false, status: "ready" }
}

function originOf(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null }
  catch { return null }
}

function waitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanup()
      reject(signal.reason ?? new Error("browser session state changed"))
    }
    signal.addEventListener("abort", abort, { once: true })
    operation.then(
      (value) => { cleanup(); resolve(value) },
      (error: unknown) => { cleanup(); reject(error) },
    )
  })
}

function requireTab(session: BrowserSession, tabId: string): BrowserTab {
  const tab = session.tabs.find((item) => item.id === tabId)
  if (!tab) throw new Error("browser tab is unavailable")
  return tab
}

function update(session: BrowserSession, patch: Partial<BrowserSession>): BrowserSession {
  return { ...session, ...patch }
}
