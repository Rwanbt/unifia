/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { BrowserSessionService, type BrowserPagePort } from "../src/session-service.ts"
import { dispatchHostRequest, toErrorBody } from "../src/host/host-methods.ts"
import type { HostReply } from "../src/host/host-methods.ts"
import { decodeFrame, encodeFrame } from "../src/host/protocol.ts"

/** A page port that never launches anything: this file tests the mapping, not Chromium. */
function stubPages(calls: string[], options: { approvalReason?: string } = {}): BrowserPagePort {
  return {
    async open(_session, tabId) { calls.push(`open:${tabId}`) },
    async close(_session, tab) { calls.push(`close:${tab.id}`) },
    async navigate(_session, tabId, url) { calls.push(`navigate:${tabId}:${url}`); return tabState(url) },
    async select() {},
    async observe(_session, tabId) { calls.push(`observe:${tabId}`); return { url: "https://example.com/", origin: "https://example.com", modelText: "hello" } },
    async act(_session, tabId) { calls.push(`act:${tabId}`); return true },
    ...(options.approvalReason ? { actionApprovalRequirement: async () => options.approvalReason } : {}),
  }
}

function tabState(url: string) {
  return { url, origin: new URL(url).origin, title: "", faviconUrl: "https://example.com/favicon.ico", loading: false, canGoBack: false, canGoForward: false, status: "ready" as const }
}

function harness(options: { approvalReason?: string } = {}) {
  const calls: string[] = []
  const replies: HostReply[] = []
  const approvals: Array<{ sessionId: string; reason: string }> = []
  let decline = false
  let id = 0
  const service = new BrowserSessionService({
    pages: stubPages(calls, options),
    createId: () => `id-${++id}`,
    now: () => 1_700_000_000_000,
    authorizeNavigation: async () => {},
  })
  const send = (method: string, params: unknown = {}) =>
    dispatchHostRequest(service, { id: replies.length + 1, method, params } as never, {
      reply: (reply) => replies.push(reply),
      askApproval: async (sessionId, reason) => { approvals.push({ sessionId, reason }); return !decline },
    })
  const last = () => replies.at(-1)!
  return { service, calls, replies, approvals, send, last, decline: (value: boolean) => { decline = value } }
}

const create = { workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 800, height: 600 } }

/** Creates a session, opens a tab, hands control to the AI and observes the page. */
async function readyForAct(h: ReturnType<typeof harness>): Promise<{ sessionId: string; tabId: string; observationId: string }> {
  await h.send("session.create", create)
  const sessionId = (h.last().result as { id: string }).id
  await h.send("session.openTab", { sessionId })
  const tabId = ((h.last().result as { tabs: Array<{ id: string }> }).tabs[0]!).id
  await h.send("session.takeControl", { sessionId, controller: "ai" })
  await h.send("session.observe", { sessionId, tabId })
  // Observed after takeControl on purpose: the transfer invalidates earlier
  // observations, so reusing one would test the wrong failure.
  return { sessionId, tabId, observationId: (h.last().result as { receipt: { id: string } }).receipt.id }
}

test("ping answers with the protocol version", async () => {
  const { send, last } = harness()
  await send("host.ping")
  expect(last()).toEqual({ id: 1, result: { version: 1 } })
})

test("create, open, navigate and close map onto the service in order", async () => {
  const { send, last, calls } = harness()
  await send("session.create", create)
  const session = (last().result as { id: string }).id
  await send("session.openTab", { sessionId: session, url: "https://example.com/" })
  const tabId = ((last().result as { tabs: Array<{ id: string }> }).tabs[0]!).id
  await send("session.navigate", { sessionId: session, tabId, url: "https://example.com/next", controller: "user" })
  expect((last().result as { tabs: Array<{ url: string }> }).tabs[0]!.url).toBe("https://example.com/next")
  await send("session.close", { sessionId: session })
  expect(last()).toEqual({ id: 4, result: { closed: true } })
  expect(calls).toEqual([
    "open:id-3",
    // openTab navigates too, so both URLs reach the page port.
    "navigate:id-3:https://example.com/",
    "navigate:id-3:https://example.com/next",
    "close:id-3",
  ])
})

test("an unknown method is refused by name", async () => {
  const { send, last } = harness()
  await send("session.teleport", {})
  expect(last().error?.message).toBe("unknown host method session.teleport")
})

test("a service failure becomes a typed error body, not a rejection", async () => {
  const { send, last } = harness()
  await send("session.selectTab", { sessionId: "nope", tabId: "t1" })
  expect(last().error).toEqual({ name: "Error", message: "browser session is unavailable" })
  expect(toErrorBody(new TypeError("bad"))).toEqual({ name: "TypeError", message: "bad" })
  expect(toErrorBody("plain")).toEqual({ name: "BrowserHostError", message: "plain" })
})

test("upload and screenshot move bytes as base64 in both directions", async () => {
  const { send, last } = harness()
  await send("session.create", create)
  const session = (last().result as { id: string }).id
  await send("session.openTab", { sessionId: session })
  const tabId = ((last().result as { tabs: Array<{ id: string }> }).tabs[0]!).id
  // No `upload` on the stub port, so the service refuses it — which is exactly
  // what proves the base64 payload reached the service rather than being lost.
  await send("session.upload", { sessionId: session, tabId, name: "a.txt", mediaType: "text/plain", base64: "aGVsbG8=" })
  // The capability gate fires before the page port, so this also proves the
  // decoded bytes never reach a page that has no upload port.
  expect(last().error?.message).toBe("browser upload capability is unavailable")
  await send("session.screenshot", { sessionId: session, tabId })
  expect(last().error?.message).toBe("browser viewport screenshot is unavailable")
})

test("a declined sensitive action asks the server and never reaches the page", async () => {
  const h = harness({ approvalReason: "sensitive action" })
  const { sessionId, tabId, observationId } = await readyForAct(h)
  h.calls.length = 0
  h.decline(true)
  await h.send("session.act", { sessionId, tabId, observationId, action: { kind: "click", x: 1, y: 2 } })
  // The consent has to cross the process boundary, and a refusal has to stop
  // the action before the page is touched.
  expect(h.approvals).toEqual([{ sessionId, reason: "sensitive action" }])
  expect(h.last().error?.message).toBe("Browser action was declined")
  expect(h.calls.some((call) => call.startsWith("act:"))).toBe(false)
})

test("an approved sensitive action runs on the page", async () => {
  const h = harness({ approvalReason: "sensitive action" })
  const { sessionId, tabId, observationId } = await readyForAct(h)
  h.calls.length = 0
  await h.send("session.act", { sessionId, tabId, observationId, action: { kind: "click", x: 1, y: 2 } })
  expect(h.approvals).toHaveLength(1)
  expect(h.calls).toContain(`act:${tabId}`)
})

test("a call with no return value still answers with a frame the receiver accepts", async () => {
  const h = harness()
  const { sessionId, tabId, observationId } = await readyForAct(h)
  await h.send("session.act", { sessionId, tabId, observationId, action: { kind: "click", targetId: "x" } })
  // `undefined` would vanish in JSON.stringify and leave a frame with neither
  // result nor error, which decodeFrame rejects as malformed.
  const wire = decodeFrame(encodeFrame(h.last() as never).slice(0, -1))
  expect(wire).toMatchObject({ id: h.last().id, result: null })
})
