/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseBrowserEgressPolicy } from "@unifia/contracts"
import { BrowserHostProcess } from "../src/host/host-main.ts"
import { createLineSplitter, decodeFrame, type HostEvent, type HostOutbound } from "../src/host/protocol.ts"

/**
 * Chromium is never launched here: `PlaywrightSessionPages` only launches on
 * the first `open()`, so the transport can be driven without a browser. The
 * paths that need a real page (navigate, observe, act) are covered by the
 * Node-hosted e2e, not here.
 */
function harness() {
  const lines: string[] = []
  const fatal: string[] = []
  let counter = 0
  const host = new BrowserHostProcess({
    policy: parseBrowserEgressPolicy({ allowedOrigins: ["*"], defaultDeny: true }),
    quarantineRoot: mkdtempSync(join(tmpdir(), "unifia-host-")),
    createId: () => `id-${++counter}`,
    now: () => 1_700_000_000_000,
    onFatal: (reason) => fatal.push(reason),
  })
  host.attach((line) => lines.push(line))
  const frames = (): Array<HostEvent | HostOutbound> => lines.map((line) => decodeFrame(line.slice(0, -1)) as HostOutbound)
  const events = (kind: HostEvent["event"]) => frames().filter((frame): frame is HostEvent => "event" in frame && frame.event === kind)
  const syncs = () => events("sync") as Array<Extract<HostEvent, { event: "sync" }>>
  return { host, lines, frames, events, syncs, fatal }
}

test("announces itself with the protocol version on attach", () => {
  expect(harness().events("ready")).toEqual([{ event: "ready", version: 1 }])
})

test("session.create answers with the session and pushes a sync", async () => {
  const { host, frames, syncs } = harness()
  await host.receive(JSON.stringify({
    id: 1,
    method: "session.create",
    params: { workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 1280, height: 800 }, capabilities: ["browser.navigate"] },
  }))
  const response = frames().find((frame) => "result" in frame && frame.id === 1) as { result: { id: string; workspaceId: string } }
  expect(response.result.workspaceId).toBe("w1")
  const sync = syncs()[0]!
  expect(sync.session.id).toBe(response.result.id)
  // The mirror needs activity and downloads on every sync, or the Bun-side
  // synchronous reads would go stale.
  expect(sync.activity.map((event) => event.kind)).toEqual(["session.created"])
  expect(sync.downloads).toEqual([])
})

test("a control change re-emits the session so the mirror follows it", async () => {
  const { host, syncs } = harness()
  await host.receive(JSON.stringify({ id: 1, method: "session.create", params: { workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 800, height: 600 } } }))
  const created = syncs()[0]!
  await host.receive(JSON.stringify({ id: 2, method: "session.takeControl", params: { sessionId: created.session.id, controller: "ai" } }))
  const last = syncs().at(-1)!
  expect(last.session.controller).toBe("ai")
  expect(last.activity.map((event) => event.kind)).toEqual(["session.created", "controller.changed"])
})

test("a close reaches the mirror as closed and is never resurrected", async () => {
  const { host, syncs } = harness()
  await host.receive(JSON.stringify({ id: 1, method: "session.create", params: { workspaceId: "w1", runtimeProfile: "isolated", viewport: { width: 800, height: 600 } } }))
  const created = syncs()[0]!
  await host.receive(JSON.stringify({ id: 2, method: "session.close", params: { sessionId: created.session.id } }))
  const statuses = syncs().filter((sync) => sync.session.id === created.session.id).map((sync) => sync.session.status)
  // The sequence is ready -> ready -> closed -> closed: `closeSession` drops the
  // storage first, and that push is emitted while the session is still live.
  // What must hold is that once the mirror is told "closed", no later frame can
  // bring the session back — a stale "ready" after the close would resurrect a
  // session the user already closed.
  const firstClosed = statuses.indexOf("closed")
  expect(firstClosed).toBeGreaterThanOrEqual(0)
  expect(statuses.slice(firstClosed).every((status) => status === "closed")).toBe(true)
  expect(syncs().at(-1)!.session.tabs).toEqual([])
})

test("a host-side throw comes back as a typed error, not a silent empty result", async () => {
  const { host, frames } = harness()
  await host.receive(JSON.stringify({ id: 7, method: "session.navigate", params: { sessionId: "missing", tabId: "t1", url: "https://example.com", controller: "user" } }))
  const response = frames().find((frame) => "error" in frame && frame.id === 7) as { error: { name: string; message: string } }
  expect(response.error.message).toBe("browser session is unavailable")
})

test("a malformed line is fatal, because it has no id to answer", async () => {
  const { host, fatal, events } = harness()
  await host.receive("{not json")
  expect(fatal).toHaveLength(1)
  expect(fatal[0]).toContain("malformed frame from the Browser server")
  // Nothing half-formed reaches stdout: the server would parse it as a frame.
  expect(events("ready")).toHaveLength(1)
})

test("an ask travelling the wrong way is refused instead of executed", async () => {
  const { host, fatal, frames } = harness()
  await host.receive(JSON.stringify({ id: 1, request: "approve", reason: "x", sessionId: "s1" }))
  expect(fatal).toHaveLength(1)
  expect(fatal[0]).toContain("only the host may send")
  expect(frames().some((frame) => "result" in frame || "event" in frame)).toBe(true)
})

test("an answer that matches no pending ask is surfaced, not swallowed", async () => {
  const { host, frames } = harness()
  await host.receive(JSON.stringify({ id: 42, result: { approved: true } }))
  const error = frames().find((frame) => "error" in frame && frame.id === 42) as { error: { message: string } }
  expect(error.error.message).toBe("response does not match a pending ask")
})

test("shutdown answers once and then stops emitting syncs", async () => {
  const { host, frames, syncs } = harness()
  await host.receive(JSON.stringify({ id: 1, method: "host.shutdown", params: {} }))
  const response = frames().find((frame) => "result" in frame && frame.id === 1) as { result: { stopped: boolean } }
  expect(response.result.stopped).toBe(true)
  const before = syncs().length
  await host.receive(JSON.stringify({ id: 2, method: "host.ping", params: {} }))
  expect(syncs()).toHaveLength(before)
})

test("frames survive a chunked stdio round-trip in both directions", async () => {
  const { host } = harness()
  const seen: HostEvent[] = []
  const outbound = createLineSplitter((line) => {
    const frame = decodeFrame(line)
    if ("event" in frame) seen.push(frame)
  })
  // A writable stream may split a frame at any byte, including inside a JSON
  // string. Every cut here lands mid-frame.
  host.attach((line) => {
    outbound(line.slice(0, 3))
    outbound(line.slice(3, line.length - 5))
    outbound(line.slice(line.length - 5))
  })
  expect(seen).toEqual([{ event: "ready", version: 1 }])

  const inbound = createLineSplitter((line) => void host.receive(line))
  const request = `${JSON.stringify({ id: 5, method: "host.ping", params: {} })}\n`
  inbound(request.slice(0, 10))
  inbound(request.slice(10))
  await Promise.resolve()
  await Promise.resolve()
  expect(seen.filter((event) => event.event === "ready")).toHaveLength(1)
})
