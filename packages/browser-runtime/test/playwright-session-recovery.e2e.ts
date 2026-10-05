/* SPDX-License-Identifier: MIT */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createServer, request as httpRequest } from "node:http"
import type { BrowserSession } from "@unifia/contracts/browser"
import { BrowserSessionService, type BrowserSessionSnapshotStore } from "../src/session-service.ts"
import { PlaywrightSessionPages, type BrowserStorageState, type BrowserStorageStateStore } from "../src/playwright-session-pages.ts"

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  if (request.url === "/set") {
    response.end("<script>document.cookie='session=kept';localStorage.setItem('setting','kept')</script><main>Saved</main>")
  } else {
    response.end("<main id='state'></main><script>document.querySelector('#state').textContent=document.cookie+' '+localStorage.getItem('setting')</script>")
  }
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
assert.ok(address && typeof address === "object")
const baseUrl = `http://127.0.0.1:${address.port}`
const snapshots = new Map<string, BrowserSession>()
const storageStates = new Map<string, BrowserStorageState>()
const snapshotsPort: BrowserSessionSnapshotStore = {
  load: () => [...snapshots.values()],
  save(session) { if (session.status === "closed") snapshots.delete(session.id); else snapshots.set(session.id, session) },
  close() {},
}
const storagePort: BrowserStorageStateStore = {
  loadStorage: (sessionId) => storageStates.get(sessionId),
  saveStorage: (sessionId, state) => { storageStates.set(sessionId, state) },
  deleteStorage: (sessionId) => { storageStates.delete(sessionId) },
}
function createProxy() {
  let proxy: ReturnType<typeof createServer> | undefined
  return {
    async start() {
      proxy = createServer((incoming, outgoing) => {
        const target = new URL(incoming.url ?? "")
        if (target.hostname !== "127.0.0.1" || target.port !== String(address.port)) {
          outgoing.writeHead(403).end()
          return
        }
        const upstream = httpRequest({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: incoming.method }, (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(outgoing)
        })
        upstream.on("error", () => outgoing.writeHead(502).end())
        incoming.pipe(upstream)
      })
      await new Promise<void>((resolve) => proxy!.listen(0, "127.0.0.1", resolve))
      const bound = proxy.address()
      assert.ok(bound && typeof bound === "object")
      return `http://127.0.0.1:${bound.port}`
    },
    async close() {
      if (proxy?.listening) await new Promise<void>((resolve, reject) => proxy!.close((error) => error ? reject(error) : resolve()))
    },
  }
}
function createService() {
  const pages = new PlaywrightSessionPages({ policy: { allowedOrigins: [], blockThirdPartyCookies: true, defaultDeny: true }, createProxy, storage: storagePort })
  return new BrowserSessionService({ pages, snapshots: snapshotsPort, createId: randomUUID, authorizeNavigation: async () => {} })
}

let current = createService()
try {
  const session = current.create({ workspaceId: "workspace-a", chatSessionId: "chat-a", runtimeProfile: "isolated", viewport: { width: 800, height: 600 } })
  const tabId = (await current.openTab(session.id, `${baseUrl}/set`)).activeTabId!
  await current.shutdown()
  assert.ok(storageStates.get(session.id)?.cookies.some((cookie) => cookie.name === "session" && cookie.value === "kept"))

  current = createService()
  assert.equal(current.get(session.id).activeTabId, tabId)
  await current.refreshTab(session.id, tabId)
  await current.navigate(session.id, tabId, `${baseUrl}/check`, "user")
  const resumed = await current.observe(session.id, tabId)
  assert.match(resumed.modelText, /session=kept kept/)

  const other = current.create({ workspaceId: "workspace-b", runtimeProfile: "isolated", viewport: { width: 800, height: 600 } })
  const otherTabId = (await current.openTab(other.id, `${baseUrl}/check`)).activeTabId!
  const isolated = await current.observe(other.id, otherTabId)
  assert.doesNotMatch(isolated.modelText, /session=kept/)
  await current.close(session.id)
  assert.equal(storageStates.has(session.id), false)
  assert.equal(snapshots.has(session.id), false)
  console.log("PlaywrightSessionPages recovery: cookie/localStorage restored and workspace isolated")
} finally {
  await current.shutdown()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
