/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { BrowserSessionService, type BrowserNetworkBlockReason, type BrowserPagePort, type BrowserPopupHandler, type BrowserSessionSnapshotStore } from "../src/session-service.ts"

function setup(snapshots?: BrowserSessionSnapshotStore) {
  let id = 0
  let time = 100
  let text = "Page content"
  let approvalReason: string | undefined
  let approvalCheck: () => Promise<string | undefined> = async () => approvalReason
  let sensitiveApproved = false
  let popupHandler: BrowserPopupHandler | undefined
  let networkBlockedHandler: ((sessionId: string, reason: BrowserNetworkBlockReason) => void) | undefined
  let openerTabId = ""
  let runAction = async (signal: AbortSignal) => { signal.throwIfAborted(); return true }
  const calls: string[] = []
  const changes: string[] = []
  const pages: BrowserPagePort = {
    async open(_session, tabId, _onDownload, _onDownloadFailure, onPopup) { calls.push(`open:${tabId}`); openerTabId = tabId; popupHandler = onPopup },
    authorizeOrigin(sessionId, url) { calls.push(`egress:${sessionId}:${new URL(url).origin}`) },
    setNetworkBlockedHandler(handler) { networkBlockedHandler = handler },
    async close(_session, tab) { calls.push(`close:${tab.id}`) },
    async closeSession(session, preserveStorage) { calls.push(`close-session:${session.id}:${Boolean(preserveStorage)}`) },
    async navigate(_session, tabId, url, approvedOrigin) {
      calls.push(`navigate:${tabId}:${url}:${approvedOrigin ?? ""}`)
      return { url, origin: url === "about:blank" ? null : new URL(url).origin, title: "Page", loading: false, canGoBack: true, canGoForward: false, status: "ready" }
    },
    async select(_session, tabId) { calls.push(`select:${tabId}`) },
    async resizeViewport(_session, viewport) { calls.push(`resize:${viewport.width}x${viewport.height}`) },
    async upload(_session, tabId, file) { calls.push(`upload:${tabId}:${file.name}:${file.bytes.byteLength}`) },
    async observe(_session, tabId) { calls.push(`observe:${tabId}`); return { url: "https://example.com", origin: "https://example.com", modelText: text } },
    async actionApprovalRequirement() { return approvalCheck() },
    async act(_session, tabId, _action, _expected, signal, approved) { calls.push(`act:${tabId}`); sensitiveApproved = Boolean(approved); return runAction(signal) },
  }
  const service = new BrowserSessionService({
    pages,
    createId: () => `id-${++id}`,
    now: () => ++time,
    snapshots,
    authorizeNavigation: async (workspaceId, url) => {
      calls.push(`authorize:${workspaceId}:${url}`)
      if (new URL(url).hostname === "blocked.example") throw new Error("blocked origin")
    },
    onChange: (sessionId) => changes.push(sessionId),
  })
  return {
    service,
    pages,
    calls,
    changes,
    changePage: (value: string) => { text = value },
    setAction: (next: typeof runAction) => { runAction = next },
    setApprovalReason: (value: string | undefined) => { approvalReason = value },
    reportNetworkBlocked: (sessionId: string, reason: BrowserNetworkBlockReason) => networkBlockedHandler?.(sessionId, reason),
    setApprovalCheck: (check: typeof approvalCheck) => { approvalCheck = check },
    sensitiveApproved: () => sensitiveApproved,
    openPopup(url: string) {
      if (!popupHandler) throw new Error("popup handler is not attached")
      let attachedTabId = ""
      popupHandler(url, openerTabId, (tabId) => { attachedTabId = tabId; calls.push(`attach-popup:${tabId}`) }, false)
      return attachedTabId
    },
  }
}

describe("BrowserSessionService", () => {
  test("restores owned tabs lazily after a process restart and requires fresh capability binding", async () => {
    const saved = new Map<string, import("@unifia/contracts/browser").BrowserSession>()
    let snapshotWrites = 0
    const snapshots: BrowserSessionSnapshotStore = {
      load: () => [...saved.values()],
      save(session) { snapshotWrites++; if (session.status === "closed") saved.delete(session.id); else saved.set(session.id, session) },
      close() {},
    }
    const first = setup(snapshots)
    const session = first.service.create({ workspaceId: "workspace-a", chatSessionId: "chat-a", runtimeProfile: "isolated", viewport: { width: 900, height: 700 }, capabilities: ["browser.interact"] })
    const opened = await first.service.openTab(session.id, "https://example.com/report")
    await first.service.takeControl(session.id, "ai")
    await first.service.shutdown()

    expect(saved.get(session.id)?.tabs).toHaveLength(1)
    expect(first.calls).toContain(`close-session:${session.id}:true`)
    const resumed = setup(snapshots)
    expect(resumed.calls).toEqual([])
    expect(resumed.service.get(session.id)).toMatchObject({ workspaceId: "workspace-a", chatSessionId: "chat-a", activeTabId: opened.activeTabId, controller: "user" })
    expect(resumed.service.forChatSession("workspace-a", "chat-a")?.capabilities).toEqual([])
    expect(resumed.service.forChatSession("workspace-b", "chat-a")).toBeUndefined()

    await resumed.service.refreshTab(session.id, opened.activeTabId!)
    expect(resumed.calls).toContain(`open:${opened.activeTabId}`)
    expect(resumed.calls).toContain(`authorize:workspace-a:https://example.com/report`)
    expect(resumed.calls).toContain(`navigate:${opened.activeTabId}:https://example.com/report:`)
    resumed.pages.state = async () => {
      const tab = resumed.service.get(session.id).tabs[0]!
      return { url: tab.url, origin: tab.origin, title: tab.title, faviconUrl: tab.faviconUrl, loading: tab.loading, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward, status: tab.status }
    }
    const writesAfterRestore = snapshotWrites
    await resumed.service.refreshTab(session.id, opened.activeTabId!)
    expect(snapshotWrites).toBe(writesAfterRestore)
    resumed.service.bindCapabilities(session.id, ["browser.observe"])
    expect(resumed.service.forChatSession("workspace-a", "chat-a")?.capabilities).toEqual(["browser.observe"])

    await resumed.service.close(session.id)
    expect(resumed.calls).toContain(`close-session:${session.id}:false`)
    expect(saved.has(session.id)).toBe(false)
  })

  test("links Browser sessions only to their own workspace chat", async () => {
    const { service } = setup()
    const first = service.create({ workspaceId: "workspace", chatSessionId: "chat-a", runtimeProfile: "isolated", viewport: { width: 900, height: 700 }, capabilities: ["browser.observe"] })
    const second = service.create({ workspaceId: "workspace", chatSessionId: "chat-b", runtimeProfile: "isolated", viewport: { width: 900, height: 700 }, capabilities: ["browser.interact"] })

    expect(service.forChatSession("workspace", "chat-a")).toEqual({ sessionId: first.id, capabilities: ["browser.observe"] })
    expect(service.forChatSession("workspace", "chat-b")).toEqual({ sessionId: second.id, capabilities: ["browser.interact"] })
    expect(service.forChatSession("other-workspace", "chat-a")).toBeUndefined()
    expect(service.forChatSession("workspace", "missing-chat")).toBeUndefined()
    await service.close(first.id)
    expect(service.forChatSession("workspace", "chat-a")).toBeUndefined()
  })

  test("returns one Browser session for concurrent workspace-chat creation", () => {
    const { service } = setup()
    const original = service.create({ workspaceId: "workspace", chatSessionId: "chat", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 }, capabilities: ["browser.observe"] })
    const duplicate = service.create({ workspaceId: "workspace", chatSessionId: "chat", runtimeProfile: "isolated", viewport: { width: 390, height: 844 }, capabilities: ["browser.interact"] })

    expect(duplicate.id).toBe(original.id)
    expect(duplicate.viewport).toEqual(original.viewport)
    expect(service.forChatSession("workspace", "chat")).toEqual({ sessionId: original.id, capabilities: ["browser.observe"] })
  })

  test("keeps tab lifecycle under session ownership", async () => {
    const { service, calls } = setup()
    const session = service.create({ workspaceId: "workspace-a", chatSessionId: "chat-a", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
    const first = await service.openTab(session.id, "https://example.com")
    const second = await service.openTab(session.id)
    const selected = await service.selectTab(session.id, first.activeTabId!)
    const closed = await service.closeTab(session.id, second.activeTabId!)

    expect(first.tabs[0]?.origin).toBe("https://example.com")
    expect(second.tabs).toHaveLength(2)
    expect(selected.activeTabId).toBe(first.tabs[0]?.id)
    expect(closed.tabs).toHaveLength(1)
    expect(calls.filter((call) => call.startsWith("open:"))).toHaveLength(2)
    expect(calls.some((call) => call.startsWith("close:"))).toBe(true)
    const activity = service.activity(session.id)
    expect(activity.map((event) => event.kind)).toEqual([
      "session.created", "tab.opened", "tab.navigated", "tab.opened", "tab.selected", "tab.closed",
    ])
    expect(service.activity(session.id, activity[2]!.sequence).map((event) => event.sequence)).toEqual([4, 5, 6])
    expect(activity.some((event) => event.detail?.includes("example.com"))).toBe(false)
  })

  test("adopts runtime popups as active session tabs", async () => {
    const { service, calls, openPopup } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const opened = await service.openTab(session.id, "https://example.com")

    const popupTabId = openPopup("https://popup.example/path")
    const updated = service.get(session.id)
    expect(updated.tabs.map((tab) => tab.id)).toEqual([opened.activeTabId, popupTabId])
    expect(updated.activeTabId).toBe(popupTabId)
    expect(updated.tabs[1]).toMatchObject({ url: "https://popup.example/path", origin: "https://popup.example" })
    expect(calls).toContain(`attach-popup:${popupTabId}`)
    expect(service.activity(session.id).at(-1)).toMatchObject({ kind: "tab.opened", tabId: popupTabId, detail: "popup" })
  })

  test("blocks an AI popup whose origin was not covered by the action approval", async () => {
    const { service, calls, openPopup } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const opened = await service.openTab(session.id, "https://example.com")
    await service.takeControl(session.id, "ai")

    expect(openPopup("https://popup.example/path")).toBe("")
    expect(service.get(session.id).tabs).toHaveLength(1)
    expect(service.activity(session.id).at(-1)).toMatchObject({
      kind: "navigation.blocked", tabId: opened.activeTabId, detail: "popup origin approval",
    })
    expect(calls.some((call) => call.startsWith("attach-popup:"))).toBe(false)
  })

  test("resizes every Browser tab only while the user controls the session", async () => {
    const { service, calls } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
    await service.openTab(session.id, "https://example.com")
    await service.openTab(session.id)

    const resized = await service.resizeViewport(session.id, { width: 820, height: 1180 })

    expect(resized.viewport).toEqual({ width: 820, height: 1180 })
    expect(calls).toContain("resize:820x1180")
    expect(service.activity(session.id).at(-1)).toMatchObject({ kind: "viewport.changed", detail: "820x1180" })
    await service.takeControl(session.id, "ai")
    await expect(service.resizeViewport(session.id, { width: 390, height: 844 })).rejects.toThrow("user does not control")
    expect(calls.filter((call) => call.startsWith("resize:"))).toEqual(["resize:820x1180"])
  })

  test("requires Browser upload capability and user control and hides file names from activity", async () => {
    const { service, calls } = setup()
    const unprivileged = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const deniedTab = await service.openTab(unprivileged.id)
    await expect(service.upload(unprivileged.id, deniedTab.activeTabId!, { name: "private.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("secret") }))
      .rejects.toThrow("browser upload capability is unavailable")

    const authorized = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 }, capabilities: ["browser.upload"] })
    const tab = await service.openTab(authorized.id)
    await service.upload(authorized.id, tab.activeTabId!, { name: "private.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("secret") })
    expect(calls).toContain(`upload:${tab.activeTabId}:private.txt:6`)
    expect(service.activity(authorized.id).at(-1)).toMatchObject({ kind: "user.upload", detail: "selected file" })
    expect(service.activity(authorized.id).at(-1)?.detail).not.toContain("private.txt")

    await service.takeControl(authorized.id, "ai")
    await expect(service.upload(authorized.id, tab.activeTabId!, { name: "private.txt", mediaType: "text/plain", bytes: new Uint8Array([1]) }))
      .rejects.toThrow("user does not control")
    expect(calls.filter((call) => call.startsWith("upload:"))).toHaveLength(1)
  })

  test("checks navigation policy before the page adapter and isolates workspace sessions", async () => {
    const { service, calls } = setup()
    const left = service.create({ workspaceId: "left", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
    const right = service.create({ workspaceId: "right", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
    const tab = await service.openTab(left.id)

    await expect(service.navigate(left.id, tab.activeTabId!, "https://blocked.example", "user")).rejects.toThrow("blocked origin")
    expect(calls.some((call) => call.includes("navigate:") && call.includes("blocked.example"))).toBe(false)
    expect(service.activity(left.id).at(-1)).toMatchObject({ kind: "navigation.blocked", detail: "network policy" })
    expect(service.activity(left.id).at(-1)?.detail).not.toContain("blocked.example")
    expect(left.profileId).not.toBe(right.profileId)
    expect(service.get(left.id).workspaceId).toBe("left")
  })

  test("blocks external protocols before direct navigation reaches policy or runtime", async () => {
    const { service, calls } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)

    await expect(service.navigate(session.id, tab.activeTabId!, "file:///private/report.pdf", "user"))
      .rejects.toThrow("external browser protocols are blocked")
    expect(calls.some((call) => call.includes("file:///private/report.pdf"))).toBe(false)
    expect(service.activity(session.id).at(-1)).toMatchObject({ kind: "navigation.blocked", detail: "external protocol" })
  })

  test("records redacted Network Authority denials in Browser activity", async () => {
    const { service, reportNetworkBlocked } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    await service.openTab(session.id, "https://example.com")

    reportNetworkBlocked(session.id, "address-denied")

    expect(service.activity(session.id).at(-1)).toMatchObject({ kind: "network.blocked", detail: "address-denied" })
    expect(service.activity(session.id).at(-1)?.detail).not.toContain("example.com")
  })

  test("binds one-time AI navigation approval to the exact canonical destination origin", async () => {
    const { service, calls } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const opened = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const destination = "https://other.example/path"

    await service.navigate(session.id, opened.activeTabId!, destination, "ai", "https://other.example")

    expect(calls).toContain(`navigate:${opened.activeTabId}:${destination}:https://other.example`)
    expect(calls).toContain(`egress:${session.id}:https://other.example`)
    await expect(service.navigate(session.id, opened.activeTabId!, "https://attacker.example/path", "ai", "https://other.example"))
      .rejects.toThrow("approved navigation origin does not match the destination")
    expect(calls).not.toContain(`egress:${session.id}:https://attacker.example`)
    expect(calls.filter((call) => call.startsWith("navigate:")).at(-1)).toBe(`navigate:${opened.activeTabId}:${destination}:https://other.example`)
  })

  test("enforces cross-origin AI navigation approval at the session authority", async () => {
    const { service, calls } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const opened = await service.openTab(session.id, "https://example.com")
    await service.takeControl(session.id, "ai")

    await expect(service.navigate(session.id, opened.activeTabId!, "https://other.example/private", "ai"))
      .rejects.toThrow("This Browser action requires user approval")
    expect(calls.some((call) => call === `navigate:${opened.activeTabId}:https://other.example/private:`)).toBe(false)
    expect(calls).not.toContain(`egress:${session.id}:https://other.example`)
    expect(service.activity(session.id).at(-1)).toMatchObject({ kind: "navigation.blocked", detail: "navigation origin approval" })
  })

  test("destroys every tab when explicitly closing a session", async () => {
    const { service, calls } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "host-assisted", viewport: { width: 900, height: 700 } })
    await service.openTab(session.id)
    await service.openTab(session.id)
    await service.close(session.id)

    expect(calls.filter((call) => call.startsWith("close:"))).toHaveLength(2)
    expect(() => service.get(session.id)).toThrow("unavailable")
  })

  test("requires fresh page observation and AI control for every action", async () => {
    const { service, calls, changePage } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const ready = await service.openTab(session.id)
    const tabId = ready.activeTabId!
    const beforeTakeover = await service.observe(session.id, tabId)
    await service.takeControl(session.id, "ai")
    await expect(service.act(session.id, tabId, beforeTakeover.receipt.id, { kind: "click", selector: "button" })).rejects.toThrow("STALE_OBSERVATION")

    const current = await service.observe(session.id, tabId)
    changePage("Changed after observation")
    await expect(service.act(session.id, tabId, current.receipt.id, { kind: "click", selector: "button" })).rejects.toThrow("STALE_OBSERVATION")
    expect(calls.some((call) => call.startsWith("act:"))).toBe(false)

    const latest = await service.observe(session.id, tabId)
    changePage("Changed again after observation")
    await expect(service.act(session.id, tabId, latest.receipt.id, { kind: "click", selector: "button" })).rejects.toThrow("STALE_OBSERVATION")
  })

  test("records a terminal failure when a Browser action fails", async () => {
    const { service, setAction } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tab.activeTabId!)
    setAction(async () => { throw new Error("selector matched no page element") })

    await expect(service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }))
      .rejects.toThrow("selector matched no page element")
    expect(service.activity(session.id).map((event) => event.kind).slice(-2)).toEqual(["action.started", "action.failed"])
  })

  test("revalidates page state after the action policy preflight", async () => {
    const { service, calls, changePage, setApprovalCheck } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    const tabId = tab.activeTabId!
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tabId)
    setApprovalCheck(async () => {
      changePage("Changed during action policy preflight")
      return undefined
    })

    await expect(service.act(session.id, tabId, observation.receipt.id, { kind: "click", selector: "button" }))
      .rejects.toThrow("STALE_OBSERVATION")
    expect(calls.some((call) => call.startsWith("act:"))).toBe(false)
    expect(service.activity(session.id).map((event) => event.kind)).not.toContain("action.started")
  })

  test("requires fresh user approval for a sensitive action and revalidates after consent", async () => {
    const { service, calls, setApprovalReason, sensitiveApproved } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tab.activeTabId!)
    setApprovalReason("This click may authorize a sensitive change.")
    let asked = ""

    await service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }, async (reason) => {
      asked = reason
    })

    expect(asked).toBe("This click may authorize a sensitive change.")
    expect(sensitiveApproved()).toBe(true)
    expect(calls.at(-1)).toBe(`act:${tab.activeTabId}`)
    expect(service.activity(session.id).map((event) => event.kind).slice(-4)).toEqual([
      "page.observed", "action.approval_required", "action.started", "action.completed",
    ])
  })

  test("records approval denial and refuses to reuse the observation", async () => {
    const { service, calls, setApprovalReason } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tab.activeTabId!)
    setApprovalReason("This click may authorize a sensitive change.")

    await expect(service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }, async () => {
      throw new Error("user rejected permission")
    })).rejects.toThrow("user rejected permission")
    await expect(service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }, async () => {}))
      .rejects.toThrow("STALE_OBSERVATION")
    expect(calls.some((call) => call.startsWith("act:"))).toBe(false)
    expect(service.activity(session.id).at(-1)?.kind).toBe("action.approval_denied")
  })

  test("records an unavailable approval path and invalidates its observation", async () => {
    const { service, setApprovalReason } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tab.activeTabId!)
    setApprovalReason("This click may authorize a sensitive change.")

    await expect(service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }))
      .rejects.toThrow("requires user approval")
    await expect(service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }, async () => {}))
      .rejects.toThrow("STALE_OBSERVATION")
    expect(service.activity(session.id).map((event) => event.kind).slice(-2)).toEqual([
      "action.approval_required", "action.approval_unavailable",
    ])
  })

  test("cancels a pending approval when the user takes control", async () => {
    const { service, calls, setApprovalReason } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tab.activeTabId!)
    setApprovalReason("This click may authorize a sensitive change.")
    let confirm!: () => void
    const action = service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }, () => new Promise<void>((resolve) => { confirm = resolve }))
    for (let attempt = 0; attempt < 20 && !confirm; attempt += 1) await Promise.resolve()
    expect(confirm).toBeFunction()

    await service.takeControl(session.id, "user")
    expect(service.activity(session.id).slice(-3).map((event) => event.kind)).toEqual([
      "action.approval_cancelled", "action.cancelled", "controller.changed",
    ])
    confirm()
    await expect(action).rejects.toThrow("browser session state changed")
    expect(calls.some((call) => call.startsWith("act:"))).toBe(false)
  })

  test("cancels approval when the observed page changes before consent completes", async () => {
    const { service, calls, changePage, setApprovalReason } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tab.activeTabId!)
    setApprovalReason("This click may authorize a sensitive change.")

    await expect(service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "button" }, async () => {
      changePage("Updated by the user")
    })).rejects.toThrow("STALE_OBSERVATION")
    expect(service.activity(session.id).at(-1)?.kind).toBe("action.approval_cancelled")
    expect(calls.some((call) => call.startsWith("act:"))).toBe(false)
  })

  test("aborts an in-flight AI action on user takeover", async () => {
    const { service, setAction } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observed = await service.observe(session.id, tab.activeTabId!)
    let started!: () => void
    const began = new Promise<void>((resolve) => { started = resolve })
    let releaseCancellation!: () => void
    const cancellationBarrier = new Promise<void>((resolve) => { releaseCancellation = resolve })
    setAction((signal) => new Promise<boolean>((_resolve, reject) => {
      started()
      signal.addEventListener("abort", () => { void cancellationBarrier.then(() => reject(signal.reason)) }, { once: true })
    }))
    const pending = service.act(session.id, tab.activeTabId!, observed.receipt.id, { kind: "click", selector: "button" })
    await began
    let takeoverSettled = false
    const takeover = service.takeControl(session.id, "user").then((updated) => { takeoverSettled = true; return updated })
    await Promise.resolve()
    expect(takeoverSettled).toBe(false)
    const duringTakeover = await service.observe(session.id, tab.activeTabId!)
    await expect(service.act(session.id, tab.activeTabId!, duringTakeover.receipt.id, { kind: "click", selector: "button" })).rejects.toThrow("control is changing")
    releaseCancellation()
    await takeover
    await expect(pending).rejects.toThrow("browser session state changed")
    expect(takeoverSettled).toBe(true)
    expect(service.activity(session.id).some((event) => event.kind === "action.cancelled")).toBe(true)
  })

  test("aborts a pending Browser action preflight before transferring control", async () => {
    const { service, calls, setApprovalCheck } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    await service.takeControl(session.id, "ai")
    const observation = await service.observe(session.id, tab.activeTabId!)
    let began!: () => void
    const preflightStarted = new Promise<void>((resolve) => { began = resolve })
    let finishPreflight!: (reason: string | undefined) => void
    setApprovalCheck(() => {
      began()
      return new Promise((resolve) => { finishPreflight = resolve })
    })
    const action = service.act(session.id, tab.activeTabId!, observation.receipt.id, { kind: "click", selector: "missing" })
    await preflightStarted

    const userSession = await service.takeControl(session.id, "user")
    await expect(action).rejects.toThrow("browser session state changed")
    expect(userSession.controller).toBe("user")
    expect(calls.some((call) => call.startsWith("act:"))).toBe(false)
    finishPreflight(undefined)
  })

  test("enforces the active controller for navigation and tab management", async () => {
    const { service, calls } = setup()
    const session = service.create({ workspaceId: "workspace", runtimeProfile: "isolated", viewport: { width: 900, height: 700 } })
    const tab = await service.openTab(session.id)
    const tabId = tab.activeTabId!
    await service.takeControl(session.id, "ai")

    await expect(service.navigate(session.id, tabId, "https://example.com/blocked-user", "user")).rejects.toThrow("user does not control")
    await expect(service.openTab(session.id)).rejects.toThrow("user does not control")
    await expect(service.selectTab(session.id, tabId)).rejects.toThrow("user does not control")
    await expect(service.closeTab(session.id, tabId)).rejects.toThrow("user does not control")
    expect(calls.some((call) => call.includes("blocked-user"))).toBe(false)

    await service.navigate(session.id, tabId, "https://example.com/ai", "ai", "https://example.com")
    await service.takeControl(session.id, "user")
    await expect(service.navigate(session.id, tabId, "https://example.com/blocked-ai", "ai")).rejects.toThrow("ai does not control")
    expect(calls.some((call) => call.includes("blocked-ai"))).toBe(false)
  })

  test("reports every session and activity change to an out-of-process mirror", async () => {
    const { service, changes } = setup()
    const session = service.create({ workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 800, height: 600 } })
    // Creation alone must be visible: a mirror that only saw later mutations
    // would never learn the session exists.
    expect(changes).toEqual([session.id])

    const tab = await service.openTab(session.id)
    expect(new Set(changes)).toEqual(new Set([tab.id]))
    const afterOpen = changes.length

    await service.navigate(tab.id, tab.tabs[0]!.id, "https://example.com", "user")
    expect(changes.length).toBeGreaterThan(afterOpen)

    await service.close(tab.id)
    expect(changes.at(-1)).toBe(tab.id)
  })

  test("peek observes a closed session that get refuses to return", async () => {
    const { service } = setup()
    const session = service.create({ workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 800, height: 600 } })
    await service.openTab(session.id)
    await service.close(session.id)
    // A mirror has to be able to see the terminal state, otherwise it keeps
    // serving a session the user already closed.
    expect(() => service.get(session.id)).toThrow("browser session is unavailable")
    expect(service.peek(session.id)?.status).toBe("closed")
    expect(service.peek("unknown")).toBeUndefined()
  })
})
