/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { BrowserPagePort } from "@unifia/browser-runtime"
import type { BrowserToolContext } from "@unifia/contracts"
import { BrowserSessionService } from "@unifia/browser-runtime"
import { BrowserActTool, BrowserControlTool, BrowserNavigateTool, BrowserObserveTool } from "../../src/tool/browser"
import { Tool } from "../../src/tool/tool"

function setup(capabilities: readonly BrowserToolContext["capabilities"][number][] = ["browser.navigate", "browser.observe", "browser.interact", "browser.control"]) {
  let id = 0
  let pageText = "Untrusted page"
  let approved = false
  const calls: string[] = []
  const pages: BrowserPagePort = {
    async open() {},
    async close() {},
    async navigate(_session, _tabId, url) {
      calls.push(`navigate:${url}`)
      pageText = `Loaded ${url}`
      return { url, origin: new URL(url).origin, title: "Loaded", loading: false, canGoBack: false, canGoForward: false, status: "ready" }
    },
    async select() {},
    async observe(_session, _tabId) {
      return {
        url: "https://example.com/private?access_token=12345678901234567890123456789012",
        origin: "https://example.com",
        modelText: `${pageText}\nhttps://example.com/private?access_token=12345678901234567890123456789012`,
      }
    },
    async actionApprovalRequirement(_session, _tabId, action) { return action.kind === "click" ? "This click needs approval" : undefined },
    async act(_session, _tabId, _action, _observation, _signal, sensitiveApproved) { approved = Boolean(sensitiveApproved); return true },
  }
  const sessions = new BrowserSessionService({ pages, createId: () => `browser-${++id}`, authorizeNavigation: async () => {} })
  const session = sessions.create({ workspaceId: "workspace", chatSessionId: "chat", runtimeProfile: "isolated", viewport: { width: 900, height: 700 }, capabilities })
  return { sessions, session, capabilities, calls, approved: () => approved }
}

function context(browser: BrowserToolContext, approvals: unknown[] = []): Tool.Context {
  return {
    sessionID: "chat" as Tool.Context["sessionID"],
    messageID: "message" as Tool.Context["messageID"],
    agent: "build",
    abort: new AbortController().signal,
    extra: { browserSession: browser },
    messages: [],
    metadata() {},
    async ask(request) { approvals.push(request) },
  }
}

describe("linked Browser agent tools", () => {
  test("navigates, observes and acts through the linked session with per-action approval", async () => {
    const state = setup()
    const tab = await state.sessions.openTab(state.session.id)
    const browser = { sessions: state.sessions, sessionId: state.session.id, capabilities: state.capabilities } as BrowserToolContext
    const approvals: unknown[] = []
    const ctx = context(browser, approvals)
    await (await BrowserControlTool.init()).execute({ controller: "ai" }, ctx)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ permission: "browser_sensitive_action", patterns: ["Take control of the Browser"] })

    const secret = "12345678901234567890123456789012"
    const navigation = await (await BrowserNavigateTool.init()).execute({ url: `https://example.com/repositories?access_token=${secret}` }, ctx)
    expect(navigation.output).toContain("https://example.com")
    expect(navigation.output).not.toContain(secret)
    expect(navigation.output).not.toContain("/repositories")
    expect(state.calls).toContain(`navigate:https://example.com/repositories?access_token=${secret}`)
    expect(approvals).toHaveLength(2)
    expect(approvals[1]).toMatchObject({ permission: "browser_sensitive_action", patterns: ["Navigate to https://example.com"] })
    await (await BrowserNavigateTool.init()).execute({ url: "https://example.com/issues" }, ctx)
    expect(approvals).toHaveLength(2)

    const observed = await (await BrowserObserveTool.init()).execute({}, ctx)
    const observation = JSON.parse(observed.output) as { observationId: string; url: string; page: string }
    const { observationId } = observation
    expect(observation.url).toBe("https://example.com")
    expect(observation.page).not.toContain(secret)
    expect(observation.page).toContain("[REDACTED:SECRET]")
    expect(observed.title).not.toContain("/private")
    const acted = await (await BrowserActTool.init()).execute({ observationId, action: { kind: "click", selector: "button" } }, ctx)

    expect(acted.output).toContain("Observe the page again")
    expect(approvals).toHaveLength(3)
    expect(state.approved()).toBe(true)
    expect(tab.activeTabId).toBe(state.sessions.get(state.session.id).activeTabId)
  })

  test("BrowserControl_AfterUserTakeover_ReclaimingNeedsApprovalAndARefusalKeepsTheUser", async () => {
    const state = setup()
    await state.sessions.openTab(state.session.id)
    await state.sessions.takeControl(state.session.id, "ai")
    const browser = { sessions: state.sessions, sessionId: state.session.id, capabilities: state.capabilities } as BrowserToolContext
    const approvals: unknown[] = []
    const control = await BrowserControlTool.init()

    // Releasing control never needs approval.
    await control.execute({ controller: "user" }, context(browser, approvals))
    expect(approvals).toHaveLength(0)
    expect(state.sessions.get(state.session.id).controller).toBe("user")

    const refusing: Tool.Context = { ...context(browser, approvals), async ask() { throw new Error("rejected") } }
    await expect(control.execute({ controller: "ai" }, refusing)).rejects.toThrow("rejected")
    expect(state.sessions.get(state.session.id).controller).toBe("user")
  })

  test("refuses Browser actions when the linked chat lacks the required capability", async () => {
    const state = setup(["browser.observe"])
    const tab = await state.sessions.openTab(state.session.id)
    await state.sessions.takeControl(state.session.id, "ai")
    const observation = await state.sessions.observe(state.session.id, tab.activeTabId!)
    const browser = { sessions: state.sessions, sessionId: state.session.id, capabilities: ["browser.observe"] } as BrowserToolContext

    await expect((await BrowserActTool.init()).execute({ observationId: observation.receipt.id, action: { kind: "click", selector: "button" } }, context(browser)))
      .rejects.toThrow("does not hold browser.interact")
  })
})
