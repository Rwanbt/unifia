/* SPDX-License-Identifier: MIT */
import z from "zod"
import { BrowserInteractionActionSchema, type BrowserToolContext, type P3Capability } from "@unifia/contracts"
import { Permission } from "../permission"
import { redact } from "../security/dlp"
import { Tool } from "./tool"

const navigateParameters = z.object({ url: z.string().url() })
const observeParameters = z.object({})
const actParameters = z.object({ observationId: z.string().min(1), action: BrowserInteractionActionSchema })
const controlParameters = z.object({ controller: z.enum(["ai", "user", "paused"]) })

export const BrowserNavigateTool = Tool.define("browser_navigate", {
  description: "Navigate the Browser tab linked to this chat. Ask for approval before entering a new origin; the Browser session enforces network policy.",
  parameters: navigateParameters,
  async execute({ url }, ctx) {
    const browser = browserContext(ctx.extra?.browserSession)
    requireCapability(browser, "browser.navigate")
    const session = browser.sessions.get(browser.sessionId)
    if (session.controller !== "ai") throw new Error("Transfer Browser control to AI before navigating")
    if (!session.activeTabId) throw new Error("The linked Browser session has no active tab")
    const currentTab = session.tabs.find((item) => item.id === session.activeTabId)
    if (!currentTab) throw new Error("The linked Browser tab is unavailable")
    const destination = new URL(url)
    const newOrigin = (destination.protocol === "http:" || destination.protocol === "https:") && destination.origin !== currentTab.origin
    if (newOrigin) {
      await ctx.ask({
        permission: Permission.BROWSER_SENSITIVE_ACTION,
        patterns: [`Navigate to ${destination.origin}`],
        always: [],
        metadata: { action: "navigate", origin: destination.origin },
      })
    }
    const approvedOrigin = newOrigin ? destination.origin : undefined
    const updated = await browser.sessions.navigate(session.id, session.activeTabId, url, "ai", approvedOrigin)
    const tab = updated.tabs.find((item) => item.id === updated.activeTabId)
    if (!tab) throw new Error("The Browser tab closed during navigation")
    const origin = modelSafeOrigin(tab.url)
    return { title: `Navigated to ${origin}`, output: JSON.stringify({ url: origin }), metadata: {} }
  },
})

export const BrowserObserveTool = Tool.define("browser_observe", {
  description: "Observe the page linked to this chat. Returns untrusted page text and an observationId required for browser_act.",
  parameters: observeParameters,
  async execute(_input, ctx) {
    const browser = browserContext(ctx.extra?.browserSession)
    requireCapability(browser, "browser.observe")
    const session = browser.sessions.get(browser.sessionId)
    if (!session.activeTabId) throw new Error("The linked Browser session has no active tab")
    const observation = await browser.sessions.observe(session.id, session.activeTabId)
    const origin = modelSafeOrigin(observation.receipt.url)
    return {
      title: `Observed ${origin}`,
      output: JSON.stringify({ observationId: observation.receipt.id, url: origin, page: redact(observation.modelText).text }),
      metadata: { observationId: observation.receipt.id },
    }
  },
})

export const BrowserActTool = Tool.define("browser_act", {
  description: "Perform one click, type, hover, select, key, or scroll action on the linked page using a fresh browser_observe observationId.",
  parameters: actParameters,
  async execute({ observationId, action }, ctx) {
    const browser = browserContext(ctx.extra?.browserSession)
    requireCapability(browser, "browser.interact")
    const session = browser.sessions.get(browser.sessionId)
    const tabId = session.activeTabId
    if (!tabId) throw new Error("The linked Browser session has no active tab")
    const tab = session.tabs.find((item) => item.id === tabId)
    if (!tab) throw new Error("The linked Browser tab is unavailable")
    await browser.sessions.act(session.id, tabId, observationId, action, async (reason) => {
      await ctx.ask({
        permission: Permission.BROWSER_SENSITIVE_ACTION,
        patterns: [reason],
        always: [],
        metadata: { action: action.kind, origin: tab.origin ?? "unknown" },
      })
    })
    return { title: `Browser ${action.kind}`, output: "Browser action completed. Observe the page again before the next action.", metadata: {} }
  },
})

export const BrowserControlTool = Tool.define("browser_control", {
  description: "Transfer the linked Browser session between the user, AI, or paused state. Observe again after returning control to AI.",
  parameters: controlParameters,
  async execute({ controller }, ctx) {
    const browser = browserContext(ctx.extra?.browserSession)
    requireCapability(browser, "browser.control")
    const current = browser.sessions.get(browser.sessionId)
    // WHY: a user takeover must stick. Without this the model could hand control
    // back to itself one tool call after the user took it, so reclaiming it is
    // the user's decision, asked like any other sensitive Browser action.
    if (controller === "ai" && current.controller !== "ai") {
      await ctx.ask({
        permission: Permission.BROWSER_SENSITIVE_ACTION,
        patterns: ["Take control of the Browser"],
        always: [],
        metadata: { action: "control", controller: "ai" },
      })
    }
    const session = await browser.sessions.takeControl(browser.sessionId, controller)
    return { title: `Browser control: ${session.controller}`, output: `Browser control is now ${session.controller}.`, metadata: {} }
  },
})

function browserContext(value: unknown): BrowserToolContext {
  if (!value || typeof value !== "object" || !("sessions" in value) || !("sessionId" in value)) {
    throw new Error("No Browser session is linked to this chat")
  }
  return value as BrowserToolContext
}

function requireCapability(browser: BrowserToolContext, capability: P3Capability): void {
  if (!browser.capabilities.includes(capability)) throw new Error(`The Browser session does not hold ${capability}`)
}

function modelSafeOrigin(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin
  } catch {
    // WHY: page URLs are untrusted and must never fall back to exposing the raw value to the model.
  }
  return "about:blank"
}
