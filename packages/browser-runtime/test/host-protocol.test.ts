/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import {
  BrowserHostProtocolError,
  BrowserHostRemoteError,
  BrowserHostUnavailableError,
  createLineSplitter,
  decodeBytes,
  decodeFrame,
  encodeBytes,
  encodeFrame,
  type HostOutbound,
} from "../src/host/protocol.ts"

test("round-trips a request frame", () => {
  const line = encodeFrame({ id: 1, method: "session.create", params: { workspaceId: "w1" } })
  expect(line.endsWith("\n")).toBe(true)
  expect(decodeFrame(line.slice(0, -1))).toEqual({ id: 1, method: "session.create", params: { workspaceId: "w1" } })
})

test("round-trips a response, an ask and each event shape", () => {
  const frames: HostOutbound[] = [
    { id: 2, result: { closed: true } },
    { id: 3, error: { name: "BrowserActionApprovalRequiredError", message: "This Browser action requires user approval" } },
    { id: 4, request: "approve", reason: "sensitive action", sessionId: "s1" },
    { event: "ready", version: 1 },
    { event: "session.closed", sessionId: "s1" },
  ]
  for (const frame of frames) expect(decodeFrame(encodeFrame(frame).slice(0, -1))).toEqual(frame)
})

test("a sync event survives the wire with its activity and downloads", () => {
  const event = {
    event: "sync" as const,
    session: { id: "s1", workspaceId: "w1", tabs: [], activeTabId: null, status: "ready" },
    activity: [{ sequence: 4, sessionId: "s1", kind: "tab.opened", controller: "user", occurredAt: 7 }],
    downloads: [],
  }
  expect(decodeFrame(encodeFrame(event).slice(0, -1))).toEqual(event)
})

test("rejects frames that are not one of the four shapes", () => {
  const rejected = [
    "",
    "not json",
    "[]",
    '"a string"',
    JSON.stringify({ method: "session.create" }),
    JSON.stringify({ id: 0, method: "session.create" }),
    JSON.stringify({ id: 1.5, method: "session.create" }),
    JSON.stringify({ id: 1, event: "unknown" }),
    JSON.stringify({ id: 1, request: "approve" }),
    JSON.stringify({ id: 1, request: "other", reason: "x" }),
    JSON.stringify({ id: 1 }),
    JSON.stringify({ id: 1, error: "boom" }),
  ]
  for (const line of rejected) expect(() => decodeFrame(line)).toThrow(BrowserHostProtocolError)
})

test("base64 carries bytes without truncation or silent repair", () => {
  const bytes = new Uint8Array([0, 1, 250, 255, 128, 64])
  expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes)
  // A screenshot is far larger than a screenshot's worth of slack; check a size
  // that would expose a JS string/array boundary.
  const large = new Uint8Array(300_000).map((_, index) => index % 256)
  expect(decodeBytes(encodeBytes(large))).toEqual(large)
  expect(encodeBytes(new Uint8Array(0))).toBe("")
  expect(() => decodeBytes("not base64!!")).toThrow(BrowserHostProtocolError)
})

test("a remote error keeps its name so the HTTP layer can map it", () => {
  const error = new BrowserHostRemoteError({ name: "BrowserActionApprovalRequiredError", message: "needs consent" })
  expect(error).toBeInstanceOf(Error)
  expect(error.name).toBe("BrowserActionApprovalRequiredError")
  expect(error.message).toBe("needs consent")
  expect(new BrowserHostUnavailableError("host exited").name).toBe("BrowserHostUnavailableError")
})

test("the splitter holds a partial line until its newline arrives", () => {
  const seen: string[] = []
  const feed = createLineSplitter((line) => seen.push(line))
  feed('{"id":1,"met')
  expect(seen).toEqual([])
  feed('hod":"session.close"')
  expect(seen).toEqual([])
  feed("}\n")
  expect(seen).toEqual(['{"id":1,"method":"session.close"}'])
  // Two frames in one chunk, and a blank line that must be dropped rather than
  // parsed into a protocol error.
  feed('{"id":2}\n\n{"id":3}\n')
  expect(seen).toEqual(['{"id":1,"method":"session.close"}', '{"id":2}', '{"id":3}'])
})
