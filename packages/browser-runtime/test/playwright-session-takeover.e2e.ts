/* SPDX-License-Identifier: MIT */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BrowserInteractionAction } from "@unifia/contracts/browser"
import { BrowserDownloadStore } from "../src/browser-download-store.ts"
import { BrowserSessionService } from "../src/session-service.ts"
import { PlaywrightSessionPages } from "../src/playwright-session-pages.ts"

const UPLOAD_SETTLE_ATTEMPTS = 20
const UPLOAD_SETTLE_INTERVAL_MS = 25

const requestedPages: string[] = []
const thirdPartyCookieRequests: string[] = []
const server = createServer((request, response) => {
  requestedPages.push(`${request.headers.host}${request.url}`)
  if (request.url === "/third-party-cookie-page") {
    response.writeHead(200, { "content-type": "text/html" })
    response.end(`<main><iframe title="Third-party cookie probe" src="http://localhost:${address.port}/cookie-set"></iframe></main>`)
    return
  }
  if (request.url === "/cookie-set") {
    response.writeHead(200, { "content-type": "text/html", "set-cookie": "thirdParty=present; SameSite=None; Secure" })
    response.end(`<main>Cookie set<script>fetch('/cookie-check',{credentials:'include'}).then(response=>response.text()).then(text=>document.body.dataset.cookieProbe=text)</script></main>`)
    return
  }
  if (request.url === "/cookie-check") {
    thirdPartyCookieRequests.push(request.headers.cookie ?? "")
    response.writeHead(200, { "content-type": "text/plain" }).end("checked")
    return
  }
  if (request.url === "/redirect") {
    response.writeHead(302, { location: `http://localhost:${address.port}/redirected` }).end()
    return
  }
  if (request.url === "/download") {
    response.writeHead(200, { "content-type": "application/pdf", "content-disposition": "attachment; filename=report.pdf" })
    response.end("%PDF-1.4\nquarantined report")
    return
  }
  response.writeHead(200, { "content-type": "text/html" })
  response.end(`<head><link rel="icon" href="${request.url?.slice(1) ?? "page"}.ico"></head><main><h1>${request.url}</h1><a href="/second">Next</a><a id="external-link" href="https://example.org/repositories">External repository</a><a id="external-protocol" href="mailto:person@example.com">External protocol</a><a id="popup" href="/popup" target="_blank">Popup</a><a id="external-popup" href="http://localhost:${address.port}/approved-popup" target="_blank">External popup</a><button id="script-popup" onclick="document.querySelector('#script-popup-result').textContent='clicked';window.open(location.href.replace('127.0.0.1','localhost'))">Script popup</button><button id="script-external-protocol" onclick="location.href='file:///unifia-browser-external-protocol-denied.txt'">External protocol script</button><span id="script-popup-result">not clicked</span><a id="download" href="/download">Download</a><input id="query" aria-label="Query"><input id="api-token" name="token" aria-label="API token" value="private-token-value"><input id="upload" type="file" aria-label="Upload"><span id="upload-result">No file</span><button id="change" onclick="document.querySelector('#result').textContent='Clicked'">Change</button><span id="result">Ready</span><form onsubmit="event.preventDefault();document.querySelector('#auth-result').textContent='Submitted'"><input type="password"><button type="submit">Continue</button></form><span id="auth-result">Not submitted</span><form action="https://example.org/search"><input id="external-query"><button type="submit">Search external</button></form><button id="hover" onmouseenter="document.querySelector('#hover-result').textContent='Hovered'">Hover</button><span id="hover-result">Not hovered</span><select id="choice"><option value="basic">Basic</option><option value="advanced">Advanced</option></select><script>document.querySelector('#upload').addEventListener('change',async event=>{const file=event.target.files[0];document.querySelector('#upload-result').textContent=file.name+':'+await file.text()})</script></main>`)
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
assert.ok(address && typeof address === "object")
const baseUrl = `http://127.0.0.1:${address.port}`
const temporaryRoot = await mkdtemp(join(tmpdir(), "unifia-browser-takeover-e2e-"))
const localProxy = () => {
  let proxy: ReturnType<typeof createServer> | undefined
  return {
    async start() {
      proxy = createServer((incoming, outgoing) => {
        const target = new URL(incoming.url ?? "")
        if (!(target.hostname === "127.0.0.1" || target.hostname === "localhost") || target.port !== String(address.port)) {
          outgoing.writeHead(403).end()
          return
        }
        const upstream = httpRequest({ hostname: "127.0.0.1", port: target.port, path: `${target.pathname}${target.search}`, method: incoming.method }, (response) => {
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
const pages = new PlaywrightSessionPages({
  policy: { allowedOrigins: [], blockThirdPartyCookies: true, defaultDeny: true },
  createProxy: localProxy,
  downloads: new BrowserDownloadStore({ quarantineRoot: join(temporaryRoot, "quarantine"), releasedRoot: join(temporaryRoot, "released"), createId: randomUUID, scanner: { async scan() { return "clean" } } }),
})
const service = new BrowserSessionService({ pages, createId: () => crypto.randomUUID(), authorizeNavigation: async () => {} })
const actAndObserve = async (sessionId: string, tabId: string, action: BrowserInteractionAction) => {
  const observation = await service.observe(sessionId, tabId)
  await service.act(sessionId, tabId, observation.receipt.id, action)
  return service.observe(sessionId, tabId)
}

try {
  console.log("Takeover E2E: starting isolated Browser")
  const session = service.create({ workspaceId: "takeover-e2e", runtimeProfile: "isolated", viewport: { width: 800, height: 600 }, capabilities: ["browser.upload"] })
  console.log("Takeover E2E: session created")
  const cookieProbeTabId = (await service.openTab(session.id, `${baseUrl}/third-party-cookie-page`)).activeTabId!
  for (let attempt = 0; thirdPartyCookieRequests.length === 0 && attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.ok(thirdPartyCookieRequests.length > 0, "third-party cookie probe reached its same-origin check")
  assert.ok(thirdPartyCookieRequests.every((cookie) => !cookie.includes("thirdParty=present")), "third-party cookies must not reach the destination server")
  await service.closeTab(session.id, cookieProbeTabId)
  const opened = await service.openTab(session.id, `${baseUrl}/first`)
  const tabId = opened.activeTabId!
  console.log("Takeover E2E: first page opened")
  const redirectTabId = (await service.openTab(session.id)).activeTabId!
  await service.takeControl(session.id, "ai")
  await assert.rejects(
    service.navigate(session.id, redirectTabId, `${baseUrl}/redirect`, "ai", baseUrl),
    /ERR_BLOCKED_BY_CLIENT|net::ERR_ABORTED/,
  )
  assert.equal(requestedPages.includes(`localhost:${address.port}/redirected`), false, "an unapproved redirect target must not receive a request")
  assert.ok(service.activity(session.id).some((event) => event.kind === "navigation.blocked" && event.detail === "navigation origin approval"))
  await service.takeControl(session.id, "user")
  await service.closeTab(session.id, redirectTabId)
  await service.navigate(session.id, tabId, `${baseUrl}/second`, "user")
  await service.takeControl(session.id, "ai")
  console.log("Takeover E2E: AI control acquired")
  await service.takeControl(session.id, "user")
  await service.takeControl(session.id, "ai")
  const protocolObservation = await service.observe(session.id, tabId)
  await assert.rejects(
    service.act(session.id, tabId, protocolObservation.receipt.id, { kind: "click", selector: "#external-protocol" }),
    /external browser protocols are blocked/,
  )
  assert.ok(service.activity(session.id).some((event) => event.kind === "navigation.blocked" && event.detail === "external protocol"), "AI Activity must report rejected protocol actions without exposing the destination")
  const scriptProtocolObservation = await service.observe(session.id, tabId)
  await service.act(session.id, tabId, scriptProtocolObservation.receipt.id, { kind: "click", selector: "#script-external-protocol" })
  await service.refreshTab(session.id, tabId)
  assert.equal(service.get(session.id).tabs.find((tab) => tab.id === tabId)?.url, `${baseUrl}/second`, "script-triggered file navigation must be intercepted before dispatch")
  await service.takeControl(session.id, "user")
  const staleTab = (await service.openTab(session.id, `${baseUrl}/stale-observation`)).activeTabId!
  await service.takeControl(session.id, "ai")
  const staleObservation = await service.observe(session.id, staleTab)
  await service.navigate(session.id, staleTab, `${baseUrl}/changed-before-act`, "ai")
  await assert.rejects(
    pages.act(service.get(session.id), staleTab, { kind: "click", selector: "#change" }, staleObservation.receipt, new AbortController().signal),
    /STALE_OBSERVATION/,
  )
  assert.match((await service.observe(session.id, staleTab)).modelText, /Ready/)
  await service.takeControl(session.id, "user")
  await service.closeTab(session.id, staleTab)
  await service.takeControl(session.id, "ai")
  const hovered = await actAndObserve(session.id, tabId, { kind: "hover", selector: "#hover" })
  assert.match(hovered.modelText, /Hovered/)
  const selected = await actAndObserve(session.id, tabId, { kind: "select", selector: "#choice", value: "advanced" })
  assert.match(selected.modelText, /Advanced/)
  const typed = await actAndObserve(session.id, tabId, { kind: "type", selector: "#query", text: "unifia" })
  assert.match(typed.modelText, /unifia/)
  const tokenObservation = await service.observe(session.id, tabId)
  assert.doesNotMatch(tokenObservation.modelText, /private-token-value/)
  await assert.rejects(
    service.act(session.id, tabId, tokenObservation.receipt.id, { kind: "type", selector: "#api-token", text: "replacement" }),
    /sensitive browser field is denied/,
  )
  const clicked = await actAndObserve(session.id, tabId, { kind: "click", selector: "#change" })
  assert.match(clicked.modelText, /Clicked/)
  const uploadInput = await service.observe(session.id, tabId)
  await service.act(session.id, tabId, uploadInput.receipt.id, { kind: "click", selector: "#upload" })
  await service.takeControl(session.id, "user")
  await service.upload(session.id, tabId, { name: "chosen.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("user-approved") })
  let uploaded = await service.observe(session.id, tabId)
  for (let attempt = 0; attempt < UPLOAD_SETTLE_ATTEMPTS && !/chosen\.txt:user-approved/.test(uploaded.modelText); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_SETTLE_INTERVAL_MS))
    uploaded = await service.observe(session.id, tabId)
  }
  assert.match(uploaded.modelText, /chosen\.txt:user-approved/)
  await service.takeControl(session.id, "ai")
  const authObservation = await service.observe(session.id, tabId)
  const externalClick = { kind: "click", selector: "#external-link" } as const
  assert.match(await service.actionApprovalRequirement(session.id, tabId, authObservation.receipt.id, externalClick), /https:\/\/example\.org.*different origin/i)
  await assert.rejects(service.act(session.id, tabId, authObservation.receipt.id, externalClick), /requires user approval/)
  const afterExternalClick = await service.observe(session.id, tabId)
  await service.act(session.id, tabId, afterExternalClick.receipt.id, { kind: "click", selector: "#external-query" })
  const externalFormObservation = await service.observe(session.id, tabId)
  assert.match(
    await service.actionApprovalRequirement(session.id, tabId, externalFormObservation.receipt.id, { kind: "key", key: "Enter" }),
    /https:\/\/example\.org.*different origin/i,
  )
  const authAction = { kind: "click", selector: "form:first-of-type button[type=submit]" } as const
  assert.match(await service.actionApprovalRequirement(session.id, tabId, externalFormObservation.receipt.id, authAction), /authentication|authorize/i)
  await service.act(session.id, tabId, externalFormObservation.receipt.id, authAction, async () => {})
  assert.match((await service.observe(session.id, tabId)).modelText, /Submitted/)
  await actAndObserve(session.id, tabId, { kind: "click", selector: "#popup" })
  const popupTabId = service.get(session.id).activeTabId!
  assert.notEqual(popupTabId, tabId)
  assert.equal(service.get(session.id).tabs.length, 2)
  assert.equal((await service.refreshTab(session.id, popupTabId)).activeTabId, popupTabId)
  await actAndObserve(session.id, popupTabId, { kind: "click", selector: "#script-popup" })
  assert.match((await service.observe(session.id, popupTabId)).modelText, /clicked/)
  assert.equal(service.get(session.id).tabs.length, 2, "an unapproved script popup must not become a Browser tab")
  assert.ok(service.activity(session.id).some((event) => event.kind === "navigation.blocked" && event.detail === "popup origin approval"))
  assert.equal(requestedPages.includes(`localhost:${address.port}/popup`), false, "an unapproved popup must be rejected before its destination loads")
  const externalPopup = await service.observe(session.id, popupTabId)
  const externalPopupAction = { kind: "click", selector: "#external-popup" } as const
  const externalPopupApproval = await service.actionApprovalRequirement(session.id, popupTabId, externalPopup.receipt.id, externalPopupAction)
  assert.match(externalPopupApproval ?? "", /http:\/\/localhost:/)
  await service.act(session.id, popupTabId, externalPopup.receipt.id, externalPopupAction, async (reason) => {
    assert.match(reason, /http:\/\/localhost:/)
  })
  const approvedPopupTabId = service.get(session.id).activeTabId!
  assert.notEqual(approvedPopupTabId, popupTabId)
  assert.equal(service.get(session.id).tabs.length, 3, "a popup matching the approved destination origin may be adopted")
  await service.takeControl(session.id, "user")
  await service.closeTab(session.id, approvedPopupTabId)
  await service.takeControl(session.id, "ai")
  await actAndObserve(session.id, popupTabId, { kind: "click", selector: "#download" })
  let quarantined = pages.downloads(session.id)[0]
  for (let attempt = 0; !quarantined && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    quarantined = pages.downloads(session.id)[0]
  }
  assert.ok(quarantined, "download event reaches the quarantine store")
  assert.equal(quarantined.filename, "report.pdf")
  assert.equal(quarantined.status, "quarantined")
  assert.ok(service.activity(session.id).some((event) => event.kind === "download.quarantined"))
  await service.takeControl(session.id, "user")
  await service.selectTab(session.id, tabId)
  await service.takeControl(session.id, "ai")
  const observation = await service.observe(session.id, tabId)
  console.log("Takeover E2E: page observed")
  const action = service.act(session.id, tabId, observation.receipt.id, { kind: "click", selector: "[data-action-that-never-exists]" })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const userSession = await service.takeControl(session.id, "user")
  console.log("Takeover E2E: interrupted action settled")
  await assert.rejects(action, /browser session state changed/)
  assert.equal(userSession.controller, "user")
  assert.equal((await service.get(session.id)).tabs[0]?.id, tabId)
  const restored = await service.refreshTab(session.id, tabId)
  assert.equal(restored.tabs[0]?.url, `${baseUrl}/second`)
  assert.ok((await service.screenshot(session.id, tabId)).byteLength > 100)
  const released = await service.releaseDownload(session.id, quarantined.id)
  assert.equal(released.status, "released")
  const workspaceDirectory = createHash("sha256").update(session.workspaceId).digest("hex")
  assert.equal(await readFile(join(temporaryRoot, "released", workspaceDirectory, "downloads", released.releasedFilename!), "utf8"), "%PDF-1.4\nquarantined report")
  const backed = await service.history(session.id, tabId, "back")
  assert.equal(backed.tabs[0]?.url, `${baseUrl}/first`)
  assert.equal(backed.tabs[0]?.faviconUrl, `${baseUrl}/first.ico`)
  console.log("PlaywrightSessionPages takeover: action cancelled, page restored, user control acquired")
} finally {
  await service.shutdown()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await rm(temporaryRoot, { recursive: true, force: true })
}
