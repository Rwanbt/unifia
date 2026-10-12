/* SPDX-License-Identifier: MIT */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { P3_CAPABILITIES } from "@unifia/contracts"
import { WorkbenchClient } from "@unifia/workbench-shell"
import { BrowserSessionService } from "@unifia/browser-runtime"
import { createWorkbenchApp, type WorkbenchConfig } from "../src/bootstrap.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-connected-surfaces-"))
try {
  await writeFile(path.join(root, "README.md"), "connected surfaces")
  const config: WorkbenchConfig = {
    signingKey: "unifia-connected-surfaces-signing-key-0123456789",
    issuer: "unifia-connected-surfaces",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "fake",
    auditLogPath: path.join(root, ".unifia", "connected-audit.jsonl"),
    rateBudget: 240,
    rateWindowMs: 60_000,
    allowlistedCapabilities: new Set(P3_CAPABILITIES),
    artifactRoot: mkdtempSync(path.join(tmpdir(), "unifia-artifacts-")),
    presentLinkTtlMs: 60_000,
  }
  let sequence = 0
  const browserUploads: Array<{ sessionId: string; tabId: string; name: string; bytes: string }> = []
  const browserSessions = new BrowserSessionService({
    createId: () => `browser-${++sequence}`,
    authorizeNavigation: async () => {},
    pages: {
      async open() {},
      async close() {},
      async navigate(_session, _tabId, url) { return { url, origin: new URL(url).origin, title: "Page", loading: false, canGoBack: false, canGoForward: false, status: "ready" } },
      async resizeViewport() {},
      async select() {},
      async observe() { return { url: "about:blank", origin: null, modelText: "Blank page" } },
      async act(_session, _tabId, _action, _expected, signal) { signal.throwIfAborted(); return true },
      async upload(session, tabId, file) { browserUploads.push({ sessionId: session.id, tabId, name: file.name, bytes: Buffer.from(file.bytes).toString("utf8") }) },
    },
  })
  const app = createWorkbenchApp(config, { browserSessions })
  const request = (input: RequestInfo | URL, init?: RequestInit) => app.server.fetch(new Request(input, init))
  const admin = app.authenticator.sign({ id: "connected-test", scopes: new Set(["workspace.register", "workspace.open", ...P3_CAPABILITIES]), workspaces: "*" }, Date.now() + 60_000)
  const authorization = { authorization: `Bearer ${admin}` }
  const registered = await request("http://local/v1/workspaces/register", { method: "POST", headers: authorization, body: JSON.stringify({ name: "connected", path: root }) })
  if (registered.status !== 201) throw new Error(`connected test could not register workspace: ${registered.status}`)
  const workspaceId = (await registered.json() as { id: string }).id
  const opened = await request(`http://local/v1/workspaces/${workspaceId}/open`, { method: "POST", headers: authorization })
  if (opened.status !== 200) throw new Error(`connected test could not open workspace: ${opened.status}`)
  const fileSession = (await opened.json() as { token: string }).token
  const transportFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set("x-unifia-file-session", fileSession)
    return request(input, { ...init, headers })
  }
  const client = new WorkbenchClient({ baseUrl: "http://local", instanceId: app.server.instanceId, fetchImpl: transportFetch as typeof fetch, token: { current: () => admin, refresh: async () => admin } })

  const handshake = await client.handshake()
  if (!handshake.accepted) throw new Error("connected surfaces handshake was refused")

  const work = await client.listFiles(workspaceId)
  if (!work.entries.some((entry) => entry.path === "README.md")) throw new Error("Work surface did not expose the workspace file")

  const design = await client.validateSpec(workspaceId, { id: "connected-design", version: "1.0.0", target: "design", title: "Connected Design", rules: [] })
  if (!design.valid || design.capabilities.denied.length !== 0) throw new Error("Design surface rejected the valid connected spec")

  const sessionResponse = await request(`http://local/v1/workspaces/${workspaceId}/sessions`, { method: "POST", headers: { ...authorization, "x-unifia-file-session": fileSession } })
  if (sessionResponse.status !== 201) throw new Error(`Code surface could not create a session: ${sessionResponse.status}`)
  const sessionId = (await sessionResponse.json() as { session: { id: string } }).session.id
  const prompt = await client.request(`/v1/sessions/${encodeURIComponent(sessionId)}/prompt`, { method: "POST", body: { prompt: "connected" }, idempotencyKey: "connected-surfaces-prompt" as never })
  if (!prompt) throw new Error("Code surface returned no prompt result")

  const browser = await client.createBrowserSession({ workspaceId, chatSessionId: sessionId, runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
  const browserPrompt = await client.sendSessionPrompt(workspaceId, sessionId, { parts: [{ type: "text", text: "inspect this page" }], agent: "build" }, browser.session.id)
  if (!browserPrompt.accepted || !browserPrompt.operationId) throw new Error("Browser-linked chat prompt was not accepted")
  const unlinkedPrompt = await request(`http://local/v1/sessions/${encodeURIComponent(sessionId)}/prompt`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, promptInput: { parts: [{ type: "text", text: "must be denied" }] }, browserSessionId: "another-chat-browser" }),
  })
  if (unlinkedPrompt.status !== 403) throw new Error(`Chat used an unlinked Browser session: ${unlinkedPrompt.status}`)
  const tabbed = await client.openBrowserTab(workspaceId, browser.session.id)
  const tabId = tabbed.session.activeTabId
  if (!tabId) throw new Error("Browser session did not activate its first tab")
  const resized = await client.resizeBrowserViewport(workspaceId, browser.session.id, { width: 820, height: 1180 })
  if (resized.session.viewport.width !== 820 || resized.session.viewport.height !== 1180) throw new Error("Browser viewport resize did not reach its session")
  await client.setBrowserController(workspaceId, browser.session.id, "ai")
  const observation = await client.observeBrowserTab(workspaceId, browser.session.id, tabId)
  const action = await client.actOnBrowserTab(workspaceId, browser.session.id, tabId, observation.receipt.id, { kind: "click", selector: "button" })
  if (!action.accepted) throw new Error("Browser action was not accepted")
  const activity = await client.browserActivity(workspaceId, browser.session.id)
  if (!activity.events.some((event) => event.kind === "action.completed" && event.tabId === tabId)) throw new Error("Browser Activity did not report the completed action")
  const wrongWorkspace = await request(`http://local/v1/browser/sessions/${browser.session.id}?workspaceId=other`, { headers: { authorization: `Bearer ${admin}`, "x-unifia-file-session": fileSession } })
  if (wrongWorkspace.status !== 403) throw new Error(`Browser session crossed workspace scope: ${wrongWorkspace.status}`)
  await client.setBrowserController(workspaceId, browser.session.id, "user")
  const upload = await client.uploadBrowserFile(workspaceId, browser.session.id, tabId, { name: "picked.txt", mediaType: "text/plain", base64: Buffer.from("user selected").toString("base64") })
  if (!("accepted" in upload) || !upload.accepted) throw new Error("Browser upload route did not accept a selected file")
  if (browserUploads[0]?.sessionId !== browser.session.id || browserUploads[0]?.tabId !== tabId || browserUploads[0]?.name !== "picked.txt" || browserUploads[0]?.bytes !== "user selected") throw new Error("Browser upload route changed file data or session scope")
  const uploadEvents = await client.browserActivity(workspaceId, browser.session.id)
  if (!uploadEvents.events.some((event) => event.kind === "user.upload" && event.detail === "selected file")) throw new Error("Browser upload was absent from activity")

  console.log("ConnectedSurfaces: Code/Work/Design/Browser passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
