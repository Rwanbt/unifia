/* SPDX-License-Identifier: MIT */
/**
 * Wire contract between the Bun server and the Node Browser host (ADR-089).
 *
 * WHY a hand-rolled framing instead of a transport library: the host is a
 * child process on stdio, both ends are ours, and the Browser authority is
 * stateful. Newline-delimited JSON keeps the channel inspectable (stderr stays
 * diagnostics, every line on stdout is a frame) and needs no port, no
 * handshake and no upgrade path. A library would add a dependency to both
 * runtimes to express what is already four message shapes.
 *
 * The four shapes:
 * - request   `{ id, method, params }`        server -> host
 * - response  `{ id, result }` | `{ id, error: { name, message } }`
 * - event     `{ event, ... }`                 host -> server, unsolicited
 * - ask       `{ id, request, ... }`           host -> server, needs an answer
 *
 * `id` is a monotonically increasing integer per direction. The two directions
 * have their own counters: an `ask` from the host and a `request` from the
 * server can be in flight at the same time and must not share a namespace.
 */
import type { BrowserActivityEvent, BrowserDownload, BrowserSession } from "@unifia/contracts/browser"
import type { BrowserStorageState } from "../playwright-session-pages.ts"

export const HOST_PROTOCOL_VERSION = 1

/** Methods the server may call on the host. Mirrors `BrowserSessionManager`. */
export type HostMethod =
  | "session.create"
  | "session.bindCapabilities"
  | "session.openTab"
  | "session.navigate"
  | "session.history"
  | "session.resizeViewport"
  | "session.refreshTab"
  | "session.selectTab"
  | "session.closeTab"
  | "session.close"
  | "session.observe"
  | "session.actionApprovalRequirement"
  | "session.act"
  | "session.input"
  | "session.upload"
  | "session.screenshot"
  | "session.releaseDownload"
  | "session.takeControl"
  | "session.shutdown"
  | "host.shutdown"
  | "host.ping"

export type HostRequest = { id: number; method: HostMethod; params: unknown }

export type HostErrorBody = { name: string; message: string }

export type HostResponse = { id: number; result?: unknown; error?: HostErrorBody }

/**
 * Unsolicited host state. The Bun side keeps a synchronous mirror of exactly
 * these four reads (`get`, `forChatSession`, `downloads`, `activity`), so every
 * mutation of any of them has to arrive here or the mirror goes stale.
 */
export type HostSyncEvent = {
  event: "sync"
  session: BrowserSession
  activity: readonly BrowserActivityEvent[]
  downloads: readonly BrowserDownload[]
  storage?: BrowserStorageState
}

export type HostReadyEvent = { event: "ready"; version: number }
export type HostEvent = HostSyncEvent | HostReadyEvent

/**
 * Host-initiated requests, answered by the server. Two kinds:
 * - `authorize`: the service wants to reach a URL. Only the server holds the
 *   egress allowlist and the audit trail, so the host cannot decide this.
 * - `approve`: a sensitive action needs the user's consent (ADR-089 §2).
 */
export type HostAuthorizeAsk = { request: "authorize"; url: string; workspaceId: string }
export type HostApproveAsk = { request: "approve"; reason: string; sessionId: string }
/** Without the id: the host allocates one per ask when it sends. */
export type HostAskInput = HostAuthorizeAsk | HostApproveAsk
export type HostAsk = ({ id: number } & HostAuthorizeAsk) | ({ id: number } & HostApproveAsk)
export type HostAskResult = { approved: boolean }

export type HostInbound = HostRequest | HostResponse | HostAsk
export type HostOutbound = HostResponse | HostAsk | HostEvent

/**
 * Errors the Bun side raises without the host having sent them. A crash is not
 * a remote error: there is no `error` body to rebuild, so it gets its own
 * class and the manager decides whether to restart.
 */
export class BrowserHostUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "BrowserHostUnavailableError"
  }
}

/** Rebuilds a host-side throw on this side, preserving `name` for the HTTP layer. */
export class BrowserHostRemoteError extends Error {
  readonly remote: HostErrorBody

  constructor(body: HostErrorBody) {
    super(body.message)
    this.name = body.name
    this.remote = body
  }
}

/** A malformed line, or a frame that is not one of the four shapes. */
export class BrowserHostProtocolError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "BrowserHostProtocolError"
  }
}

/** Bytes travel as base64: NDJSON is text, screenshots and uploads are not. */
export function encodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
}

export function decodeBytes(value: string): Uint8Array {
  const bytes = Buffer.from(value, "base64")
  // Buffer.from is lenient: it silently drops invalid characters, so a
  // truncated or corrupt payload would decode to a shorter buffer and reach
  // Playwright as a truncated file. Re-encoding is the only cheap round-trip
  // check that catches it.
  if (bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new BrowserHostProtocolError("host payload is not valid base64")
  }
  return new Uint8Array(bytes)
}

export function encodeFrame(message: HostInbound | HostOutbound): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * The unvalidated view of a frame. Every field is `unknown` because the parse
 * below is what narrows it: reading `frame.request` as a literal before the
 * guard would make the comparison a tautology to the type checker.
 */
type FrameGuard = {
  id?: unknown
  request?: unknown
  event?: unknown
  method?: unknown
  reason?: unknown
  url?: unknown
  workspaceId?: unknown
  sessionId?: unknown
  error?: unknown
  result?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Parses one line. Rejects anything that is not a well-formed frame instead of
 * guessing: a mis-parsed request would be executed against the live browser
 * with the wrong arguments.
 */
export function decodeFrame(line: string): HostInbound | HostOutbound {
  if (line.length === 0) throw new BrowserHostProtocolError("empty host frame")
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new BrowserHostProtocolError("host frame is not valid JSON", { cause: error })
  }
  if (!isRecord(value)) throw new BrowserHostProtocolError("host frame is not an object")
  const frame = value as FrameGuard
  // Events are checked before the id guard: they are unsolicited and carry no
  // id, so requiring one first would reject every sync the host emits.
  if (frame.event !== undefined) {
    if (frame.event !== "sync" && frame.event !== "ready") {
      throw new BrowserHostProtocolError("unknown host event")
    }
    return value as HostEvent
  }
  if (typeof frame.id !== "number" || !Number.isSafeInteger(frame.id) || frame.id < 1) {
    throw new BrowserHostProtocolError("host frame id is missing or invalid")
  }
  if (frame.request !== undefined) {
    if (frame.request === "authorize") {
      if (typeof frame.url !== "string" || typeof frame.workspaceId !== "string") {
        throw new BrowserHostProtocolError("host authorize ask is malformed")
      }
    } else if (frame.request === "approve") {
      if (typeof frame.reason !== "string" || typeof frame.sessionId !== "string") {
        throw new BrowserHostProtocolError("host approve ask is malformed")
      }
    } else throw new BrowserHostProtocolError("unknown host ask")
    return value as HostAsk
  }
  if (frame.method !== undefined) {
    if (typeof frame.method !== "string" || frame.method.length === 0) {
      throw new BrowserHostProtocolError("host request method is invalid")
    }
    return value as HostRequest
  }
  if (!("result" in value) && !("error" in value)) throw new BrowserHostProtocolError("host frame carries no method, event, ask or result")
  if (frame.error !== undefined && !isRecord(frame.error)) throw new BrowserHostProtocolError("host error body is invalid")
  return value as HostResponse
}

/** Splits a byte stream into complete lines, holding the partial tail. */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => string {
  let buffer = ""
  return (chunk) => {
    buffer += chunk
    let index = buffer.indexOf("\n")
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (line.trim().length > 0) onLine(line)
      index = buffer.indexOf("\n")
    }
    return buffer
  }
}
