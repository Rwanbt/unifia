/* SPDX-License-Identifier: MIT */

// Browser mode with the leases the shipped app actually holds.
//
// The other browser suites sign tokens with every capability, or with one
// hand-picked list, so they never saw what the desktop app does: lease the
// Design surface first, then a second, browser-only lease for the same
// workspace through the same native issuer. That second lease replaced the
// first one (the issuer kept one lease per workspace), so every Browser action
// after it ended in a generic failure while all the tests stayed green.

import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BrowserSessionService } from "@unifia/browser-runtime"
import { BROWSER_LEASE_CAPABILITIES, SURFACE_LEASE_CAPABILITIES } from "@unifia/workbench-shell"
import { createWorkbenchApp, type WorkbenchConfig } from "../src/bootstrap.js"
import { SURFACE_GRANTED_CAPABILITIES } from "../src/constants.js"

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const pageAt = (url: string) => ({ url, origin: new URL(url).origin, title: "Page", loading: false, canGoBack: false, canGoForward: false, status: "ready" as const })

let root: string
let app: ReturnType<typeof createWorkbenchApp>
let workspaceId: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unifia-browser-lease-"))
  await writeFile(path.join(root, "README.md"), "browser lease")
  const config: WorkbenchConfig = {
    signingKey: "unifia-browser-lease-signing-key-0123456789",
    issuer: "unifia-browser-lease",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "fake",
    auditLogPath: path.join(root, ".unifia", "browser-lease-audit.jsonl"),
    rateBudget: 1_000,
    rateWindowMs: 60_000,
    // The sidecar's allowlist (packages/unifia/src/server/workbench.ts), not every capability.
    allowlistedCapabilities: new Set(SURFACE_GRANTED_CAPABILITIES),
    artifactRoot: mkdtempSync(path.join(os.tmpdir(), "unifia-browser-lease-artifacts-")),
    presentLinkTtlMs: 60_000,
  }
  let sequence = 0
  const browserSessions = new BrowserSessionService({
    createId: () => `browser-${++sequence}`,
    authorizeNavigation: async () => {},
    pages: {
      async open() {},
      async close() {},
      async closeSession() {},
      async navigate(_session, _tabId, url) { return pageAt(url) },
      async history() { return pageAt("https://example.test/") },
      async state() { return pageAt("https://example.test/state") },
      async resizeViewport() {},
      async select() {},
      async observe() { return { url: "about:blank", origin: null, modelText: "" } },
      async act() { return true },
      async input() { return { editableFocused: false } },
      async screenshot() { return PNG_BYTES },
      downloads() { return [] },
      async releaseDownload() { throw new Error("no download") },
    },
  })
  app = createWorkbenchApp(config, { browserSessions })
  workspaceId = (await app.workspace.register({ name: "browser-lease", path: root })).id
})

afterAll(async () => {
  await app.server.shutdown()
  await rm(root, { recursive: true, force: true })
})

const issue = (capabilities: readonly string[]) =>
  app.server.issueNativeScopedToken({ principalId: "native", workspaceId, capabilities: [...capabilities] as never })

function call(token: string, method: string, route: string, body?: Record<string, unknown>) {
  const url = new URL(`http://local${route}`)
  if (method === "GET") url.searchParams.set("workspaceId", workspaceId)
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}`, "x-unifia-file-session": token } }
  if (method !== "GET") init.body = JSON.stringify({ workspaceId, ...body })
  return app.server.fetch(new Request(url, init))
}

describe("Browser mode with the production leases", () => {
  it("navigates with the browser lease while the surface lease stays valid", async () => {
    const surface = await issue(SURFACE_LEASE_CAPABILITIES)
    const browser = await issue(BROWSER_LEASE_CAPABILITIES)

    const created = await call(browser.token, "POST", "/v1/browser/sessions", { runtimeProfile: "isolated", viewport: { width: 1280, height: 800 } })
    expect(created.status).toBe(201)
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id
    const tabbed = await call(browser.token, "POST", `/v1/browser/sessions/${sessionId}/tabs`, { url: "https://example.test/" })
    expect(tabbed.status).toBe(201)
    const tabId = ((await tabbed.json()) as { session: { activeTabId: string } }).session.activeTabId
    const navigated = await call(browser.token, "POST", `/v1/browser/sessions/${sessionId}/tabs/${tabId}/navigate`, { url: "https://example.test/next" })
    expect(navigated.status).toBe(200)
    expect((await call(browser.token, "GET", `/v1/browser/sessions/${sessionId}/tabs/${tabId}/screenshot`)).status).toBe(200)

    // The Design surface must not lose its connection because Browser opened.
    expect(app.tokenIssuer.verify(surface.token)).toBeDefined()
  })

  it("rotating one lease leaves the other lease valid", async () => {
    const surface = await issue(SURFACE_LEASE_CAPABILITIES)
    const browser = await issue(BROWSER_LEASE_CAPABILITIES)
    const rotated = await app.server.rotateNativeScopedToken({ principalId: "native", workspaceId, capabilities: [...SURFACE_LEASE_CAPABILITIES] as never })
    expect(app.tokenIssuer.verify(rotated.token.token)).toBeDefined()
    expect(app.tokenIssuer.verify(browser.token)).toBeDefined()
    expect(app.tokenIssuer.verify(surface.token)).toBeDefined() // still inside its rotation grace period
  })

  it("re-issuing the same lease still replaces the previous token", async () => {
    const first = await issue(BROWSER_LEASE_CAPABILITIES)
    await issue(BROWSER_LEASE_CAPABILITIES)
    expect(app.tokenIssuer.verify(first.token)).toBeUndefined()
  })
})
