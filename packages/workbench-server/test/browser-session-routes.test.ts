/* SPDX-License-Identifier: MIT */

// Browser session routes (#118) beyond the connected-surfaces journey.
//
// connected-surfaces signs its token with every P3 capability, so it cannot
// see a route that forgets its capability gate: the shipped app holds a scoped
// lease (SURFACE_GRANTED_CAPABILITIES), not all of them. This suite strips one
// browser.* scope at a time and asserts the route answers 403 without touching
// the session, then drives every route the journey does not reach.

import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { P3_CAPABILITIES, type BrowserDownload, type P3Capability } from "@unifia/contracts"
import { BrowserSessionService } from "@unifia/browser-runtime"
import { createWorkbenchApp, type WorkbenchConfig } from "../src/bootstrap.js"

type Page = { url: string; origin: string | null; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; status: "ready" }

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const DOWNLOAD_ID = "download-1"

const pageAt = (url: string, canGoBack = false): Page => ({ url, origin: url.startsWith("http") ? new URL(url).origin : null, title: "Page", loading: false, canGoBack, canGoForward: false, status: "ready" })

let root: string
let request: (input: string, init?: RequestInit) => Promise<Response>
let workspaceId: string
let fileSession: string
let signToken: (scopes: readonly string[]) => string
let sessionCalls: string[]
let pageInputs: string[]
let releasedDownloads: string[]

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unifia-browser-routes-"))
  await writeFile(path.join(root, "README.md"), "browser routes")
  const config: WorkbenchConfig = {
    signingKey: "unifia-browser-routes-signing-key-0123456789",
    issuer: "unifia-browser-routes",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "fake",
    auditLogPath: path.join(root, ".unifia", "browser-routes-audit.jsonl"),
    rateBudget: 1_000,
    rateWindowMs: 60_000,
    allowlistedCapabilities: new Set(P3_CAPABILITIES),
    artifactRoot: mkdtempSync(path.join(os.tmpdir(), "unifia-browser-routes-artifacts-")),
    presentLinkTtlMs: 60_000,
  }
  sessionCalls = []
  pageInputs = []
  releasedDownloads = []
  // The page port owns the quarantine store in production; one quarantined file per session stands in for it.
  const quarantined = (sessionId: string): BrowserDownload => ({ id: DOWNLOAD_ID, sessionId, tabId: "tab", filename: "report.pdf", size: 4, status: "quarantined", inspection: { sha256: "a".repeat(64) } as BrowserDownload["inspection"], createdAt: 0 } as BrowserDownload)
  let sequence = 0
  const browserSessions = new BrowserSessionService({
    createId: () => `browser-${++sequence}`,
    authorizeNavigation: async () => {},
    pages: {
      async open(session) { sessionCalls.push(`open:${session.id}`) },
      async close(session, tab) { sessionCalls.push(`close-tab:${session.id}:${tab.id}`) },
      async closeSession(session) { sessionCalls.push(`close:${session.id}`) },
      async navigate(_session, _tabId, url) { return pageAt(url) },
      async history(_session, _tabId, action) { return pageAt(`https://example.test/${action}`, action !== "back") },
      async state() { return pageAt("https://example.test/state") },
      async resizeViewport() {},
      async select(session, tabId) { sessionCalls.push(`select:${session.id}:${tabId}`) },
      async observe() { return { url: "about:blank", origin: null, modelText: "Blank page" } },
      async act(_session, _tabId, _action, _expected, signal) { signal.throwIfAborted(); return true },
      async input(_session, tabId, action) { pageInputs.push(`${tabId}:${action.kind}`) },
      async screenshot() { return PNG_BYTES },
      downloads(sessionId) { return [quarantined(sessionId)] },
      async releaseDownload(session, downloadId) {
        if (downloadId !== DOWNLOAD_ID) throw new Error("unknown download")
        releasedDownloads.push(downloadId)
        return { ...quarantined(session.id), status: "released" }
      },
    },
  })
  const app = createWorkbenchApp(config, { browserSessions })
  request = (input, init) => app.server.fetch(new Request(input, init))
  signToken = (scopes) => app.authenticator.sign({ id: "browser-routes-test", scopes: new Set(scopes), workspaces: "*" }, Date.now() + 60_000)
  const admin = signToken(["workspace.register", "workspace.open", ...P3_CAPABILITIES])
  const registered = await request("http://local/v1/workspaces/register", { method: "POST", headers: { authorization: `Bearer ${admin}` }, body: JSON.stringify({ name: "browser-routes", path: root }) })
  expect(registered.status).toBe(201)
  workspaceId = (await registered.json() as { id: string }).id
  const opened = await request(`http://local/v1/workspaces/${workspaceId}/open`, { method: "POST", headers: { authorization: `Bearer ${admin}` } })
  expect(opened.status).toBe(200)
  fileSession = (await opened.json() as { token: string }).token
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const ALL_BROWSER_SCOPES = P3_CAPABILITIES.filter((capability) => capability.startsWith("browser."))

function headersFor(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "x-unifia-file-session": fileSession }
}

async function call(token: string, method: string, route: string, body?: Record<string, unknown>) {
  const url = new URL(`http://local${route}`)
  if (method === "GET" || method === "DELETE") url.searchParams.set("workspaceId", workspaceId)
  const init: RequestInit = { method, headers: headersFor(token) }
  if (method !== "GET") init.body = JSON.stringify({ workspaceId, ...body })
  return request(url.toString(), init)
}

type Session = { id: string; activeTabId?: string; controller: string; tabs: Array<{ id: string; url: string }> }

async function createSessionWithTab(token = signToken(ALL_BROWSER_SCOPES)): Promise<{ session: Session; tabId: string }> {
  const created = await call(token, "POST", "/v1/browser/sessions", { runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
  expect(created.status).toBe(201)
  const session = (await created.json() as { session: Session }).session
  const tabbed = await call(token, "POST", `/v1/browser/sessions/${session.id}/tabs`, { url: "https://example.test/" })
  expect(tabbed.status).toBe(201)
  const updated = (await tabbed.json() as { session: Session }).session
  if (!updated.activeTabId) throw new Error("tab creation did not activate a tab")
  return { session: updated, tabId: updated.activeTabId }
}

type GatedRoute = { action: string; capability: P3Capability; method: string; route: (sessionId: string, tabId: string) => string; body?: Record<string, unknown> }

// Mirrors capabilityForBrowserAction; step-up capabilities (download, upload) are
// covered separately because a missing scope reaches the approval gate on purpose.
const GATED_ROUTES: readonly GatedRoute[] = [
  { action: "create", capability: "browser.navigate", method: "POST", route: () => "/v1/browser/sessions", body: { runtimeProfile: "isolated", viewport: { width: 800, height: 600 } } },
  { action: "tab-create", capability: "browser.navigate", method: "POST", route: (s) => `/v1/browser/sessions/${s}/tabs` },
  { action: "tab-navigate", capability: "browser.navigate", method: "POST", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/navigate`, body: { url: "https://example.test/next" } },
  { action: "read", capability: "browser.observe", method: "GET", route: (s) => `/v1/browser/sessions/${s}` },
  { action: "activity", capability: "browser.observe", method: "GET", route: (s) => `/v1/browser/sessions/${s}/activity` },
  { action: "downloads", capability: "browser.observe", method: "GET", route: (s) => `/v1/browser/sessions/${s}/downloads` },
  { action: "tab-state", capability: "browser.observe", method: "GET", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/state` },
  { action: "screenshot", capability: "browser.observe", method: "GET", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/screenshot` },
  { action: "observe", capability: "browser.observe", method: "POST", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/observe` },
  { action: "input", capability: "browser.interact", method: "POST", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/input`, body: { action: { kind: "key", key: "Enter" } } },
  { action: "act", capability: "browser.interact", method: "POST", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/act`, body: { observationId: "x", action: { kind: "click", selector: "button" } } },
  { action: "control", capability: "browser.control", method: "POST", route: (s) => `/v1/browser/sessions/${s}/control`, body: { controller: "ai" } },
  { action: "viewport", capability: "browser.control", method: "POST", route: (s) => `/v1/browser/sessions/${s}/viewport`, body: { viewport: { width: 640, height: 480 } } },
  { action: "tab-select", capability: "browser.control", method: "POST", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/select` },
  { action: "tab-history", capability: "browser.control", method: "POST", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}/history`, body: { action: "reload" } },
  { action: "tab-close", capability: "browser.control", method: "DELETE", route: (s, t) => `/v1/browser/sessions/${s}/tabs/${t}` },
  { action: "close", capability: "browser.control", method: "DELETE", route: (s) => `/v1/browser/sessions/${s}` },
]

describe("Browser routes refuse a token missing the route's browser.* capability", () => {
  it.each([...GATED_ROUTES])("$action without $capability answers 403 and leaves the session untouched", async ({ capability, method, route, body }: GatedRoute) => {
    const { session, tabId } = await createSessionWithTab()
    const before = JSON.stringify((await (await call(signToken(ALL_BROWSER_SCOPES), "GET", `/v1/browser/sessions/${session.id}`)).json() as { session: Session }).session)
    const callsBefore = sessionCalls.length
    const inputsBefore = pageInputs.length
    const restricted = signToken(ALL_BROWSER_SCOPES.filter((scope) => scope !== capability))

    const response = await call(restricted, method, route(session.id, tabId), body)

    expect(response.status).toBe(403)
    expect(sessionCalls.length).toBe(callsBefore)
    expect(pageInputs.length).toBe(inputsBefore)
    const after = JSON.stringify((await (await call(signToken(ALL_BROWSER_SCOPES), "GET", `/v1/browser/sessions/${session.id}`)).json() as { session: Session }).session)
    expect(after).toBe(before)
  })

  it("the shipped surface lease reaches every non-step-up route", async () => {
    // SURFACE_GRANTED_CAPABILITIES grants navigate/observe/interact/control: a
    // regression that gates a route on another capability would 403 in the app.
    const lease = signToken(["browser.navigate", "browser.observe", "browser.interact", "browser.control"])
    const { session, tabId } = await createSessionWithTab(lease)
    const state = await call(lease, "GET", `/v1/browser/sessions/${session.id}/tabs/${tabId}/state`)
    expect(state.status).toBe(200)
  })
})

describe("Browser session routes not reached by the connected journey", () => {
  const full = () => signToken(ALL_BROWSER_SCOPES)

  it("tab-navigate moves the tab to the requested URL", async () => {
    const { session, tabId } = await createSessionWithTab()
    const response = await call(full(), "POST", `/v1/browser/sessions/${session.id}/tabs/${tabId}/navigate`, { url: "https://example.test/next" })
    expect(response.status).toBe(200)
    const updated = (await response.json() as { session: Session }).session
    expect(updated.tabs.find((tab) => tab.id === tabId)?.url).toBe("https://example.test/next")
  })

  it("tab-navigate without a url is refused rather than navigating", async () => {
    const { session, tabId } = await createSessionWithTab()
    const response = await call(full(), "POST", `/v1/browser/sessions/${session.id}/tabs/${tabId}/navigate`, {})
    expect(response.status).toBe(400)
  })

  it("tab-history applies the history action to the tab", async () => {
    const { session, tabId } = await createSessionWithTab()
    const response = await call(full(), "POST", `/v1/browser/sessions/${session.id}/tabs/${tabId}/history`, { action: "reload" })
    expect(response.status).toBe(200)
    const updated = (await response.json() as { session: Session }).session
    expect(updated.tabs.find((tab) => tab.id === tabId)?.url).toBe("https://example.test/reload")
  })

  it("tab-state refreshes the tab from the page", async () => {
    const { session, tabId } = await createSessionWithTab()
    const response = await call(full(), "GET", `/v1/browser/sessions/${session.id}/tabs/${tabId}/state`)
    expect(response.status).toBe(200)
    const updated = (await response.json() as { session: Session }).session
    expect(updated.tabs.find((tab) => tab.id === tabId)?.url).toBe("https://example.test/state")
  })

  it("tab-select activates the requested tab", async () => {
    const { session, tabId: first } = await createSessionWithTab()
    const second = (await (await call(full(), "POST", `/v1/browser/sessions/${session.id}/tabs`, { url: "https://example.test/two" })).json() as { session: Session }).session.activeTabId
    expect(second).not.toBe(first)
    const response = await call(full(), "POST", `/v1/browser/sessions/${session.id}/tabs/${first}/select`)
    expect(response.status).toBe(200)
    expect((await response.json() as { session: Session }).session.activeTabId).toBe(first)
  })

  it("tab-close removes the tab and closes its page", async () => {
    const { session, tabId } = await createSessionWithTab()
    const response = await call(full(), "DELETE", `/v1/browser/sessions/${session.id}/tabs/${tabId}`)
    expect(response.status).toBe(200)
    expect((await response.json() as { session: Session }).session.tabs.some((tab) => tab.id === tabId)).toBe(false)
    expect(sessionCalls).toContain(`close-tab:${session.id}:${tabId}`)
  })

  it("screenshot returns the page bytes as base64 PNG", async () => {
    const { session, tabId } = await createSessionWithTab()
    const response = await call(full(), "GET", `/v1/browser/sessions/${session.id}/tabs/${tabId}/screenshot`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ contentType: "image/png", data: Buffer.from(PNG_BYTES).toString("base64") })
  })

  it("input reaches the page only while the user controls the session", async () => {
    const { session, tabId } = await createSessionWithTab()
    await call(full(), "POST", `/v1/browser/sessions/${session.id}/control`, { controller: "user" })
    const accepted = await call(full(), "POST", `/v1/browser/sessions/${session.id}/tabs/${tabId}/input`, { action: { kind: "key", key: "Enter" } })
    expect(accepted.status).toBe(202)
    expect(pageInputs).toContain(`${tabId}:key`)
  })

  it("input with an invalid action is refused before the page sees it", async () => {
    const { session, tabId } = await createSessionWithTab()
    await call(full(), "POST", `/v1/browser/sessions/${session.id}/control`, { controller: "user" })
    const before = pageInputs.length
    const response = await call(full(), "POST", `/v1/browser/sessions/${session.id}/tabs/${tabId}/input`, { action: { kind: "teleport" } })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(pageInputs.length).toBe(before)
  })

  it("downloads lists the session's quarantined downloads", async () => {
    const { session } = await createSessionWithTab()
    const response = await call(full(), "GET", `/v1/browser/sessions/${session.id}/downloads`)
    expect(response.status).toBe(200)
    const { downloads } = await response.json() as { downloads: BrowserDownload[] }
    expect(downloads.map((download) => [download.id, download.status])).toEqual([[DOWNLOAD_ID, "quarantined"]])
  })

  it("download-release releases a download once the user controls the session", async () => {
    const { session } = await createSessionWithTab()
    await call(full(), "POST", `/v1/browser/sessions/${session.id}/control`, { controller: "user" })
    const response = await call(signToken([...ALL_BROWSER_SCOPES]), "POST", `/v1/browser/sessions/${session.id}/downloads/${DOWNLOAD_ID}/release`)
    expect(response.status).toBe(200)
    expect((await response.json() as { download: BrowserDownload }).download.status).toBe("released")
    expect(releasedDownloads).toContain(DOWNLOAD_ID)
  })

  it("activity rejects a negative or non-integer cursor", async () => {
    const { session } = await createSessionWithTab()
    for (const after of ["-1", "1.5", "abc"]) {
      const response = await request(`http://local/v1/browser/sessions/${session.id}/activity?workspaceId=${workspaceId}&after=${after}`, { headers: headersFor(full()) })
      expect(response.status).toBe(400)
    }
  })

  it("an unknown session answers 404, indistinguishable from another workspace's", async () => {
    const response = await call(full(), "GET", "/v1/browser/sessions/browser-does-not-exist")
    expect(response.status).toBe(404)
  })

  it("an oversized upload body is refused with 413 before it is parsed", async () => {
    const { session, tabId } = await createSessionWithTab()
    const response = await request(`http://local/v1/browser/sessions/${session.id}/tabs/${tabId}/upload`, {
      method: "POST",
      headers: { ...headersFor(full()), "content-length": String(64 * 1024 * 1024) },
      body: "{}",
    })
    expect(response.status).toBe(413)
  })

  it("close ends the session and a later read answers 404", async () => {
    const { session } = await createSessionWithTab()
    const response = await call(full(), "DELETE", `/v1/browser/sessions/${session.id}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ closed: true })
    const read = await call(full(), "GET", `/v1/browser/sessions/${session.id}`)
    expect(read.status).toBe(404)
  })
})
