/* SPDX-License-Identifier: MIT */
/**
 * The Node-side Browser host (ADR-089).
 *
 * Runs under Node, never under Bun: Playwright never settles under Bun on
 * Windows (#279), and Bun's native WebSocket gets an immediate CDP reply from
 * the same Chromium, so the blocker is the runtime, not the network.
 *
 * The whole Browser authority lives in this process — `BrowserSessionService`,
 * `PlaywrightSessionPages`, the egress proxy and the download store — because
 * the page port cannot cross a process boundary: its popup handler must answer
 * synchronously and `downloads()` is read synchronously (ADR-089 §1).
 *
 * This file owns the lifecycle and the mirror: it builds the service, turns
 * every change into a `sync` the Bun side can mirror, and carries the two asks
 * the host cannot answer for itself. The wire methods are in `host-methods.ts`.
 *
 * stdout carries frames only; anything human-readable goes to stderr, because a
 * stray log line on stdout would be parsed as a frame.
 */
import { BrowserSessionService, type BrowserSessionSnapshotStore } from "../session-service.ts"
import { BrowserDownloadStore, type BrowserDownloadScanner } from "../browser-download-store.ts"
import { PlaywrightSessionPages, type BrowserStorageState, type BrowserStorageStateStore } from "../playwright-session-pages.ts"
import type { BrowserEgressPolicy, BrowserSession } from "@unifia/contracts"
import {
  HOST_PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
  type HostAskInput,
  type HostAskResult,
  type HostErrorBody,
  type HostEvent,
  type HostRequest,
} from "./protocol.ts"
import { dispatchHostRequest, type HostReply } from "./host-methods.ts"

export type HostEnvironment = {
  policy: BrowserEgressPolicy
  quarantineRoot: string
  releasedRoot?: string
  createId: () => string
  scanner?: BrowserDownloadScanner
  /** Seeded by the server from the encrypted SQLite store, which stays on its side (ADR-089 §4). */
  sessions?: readonly BrowserSession[]
  storage?: Readonly<Record<string, BrowserStorageState>>
  now?: () => number
  /** Injected so tests can observe a fatal frame without killing the runner. */
  onFatal?: (reason: string) => void
}

type Outbound =
  | HostEvent
  | HostReply
  | ({ id: number } & HostAskInput)

export class BrowserHostProcess {
  readonly #service: BrowserSessionService
  readonly #storage = new Map<string, BrowserStorageState>()
  /** Outstanding asks, keyed by the host's own id counter. */
  readonly #asks = new Map<number, (approved: boolean) => void>()
  #outbound: (line: string) => void = () => {}
  #onFatal: (reason: string) => void
  #nextAskId = 1
  #closed = false

  constructor(environment: HostEnvironment) {
    this.#onFatal = environment.onFatal ?? defaultOnFatal
    this.#storage = new Map(Object.entries(environment.storage ?? {}))
    const storage: BrowserStorageStateStore = {
      loadStorage: (sessionId) => this.#storage.get(sessionId),
      saveStorage: (sessionId, state) => {
        this.#storage.set(sessionId, state)
        // Storage is not part of the session object, so a cookie change would
        // never reach the server's encrypted store without this explicit push.
        this.#emitSync(sessionId, state)
      },
      deleteStorage: (sessionId) => {
        this.#storage.delete(sessionId)
        // Emitted while `close` is still running, so this frame can carry a
        // session that is live for one more instant. The mirror converges on
        // the closed sync that follows, and a stale "ready" can never arrive
        // after it.
        this.#emitSync(sessionId)
      },
    }
    const snapshots: BrowserSessionSnapshotStore = {
      load: () => environment.sessions ?? [],
      // The server owns persistence; the host keeps no second copy of it.
      save: () => {},
      close: () => {},
    }
    const downloads = new BrowserDownloadStore({
      quarantineRoot: environment.quarantineRoot,
      ...(environment.releasedRoot ? { releasedRoot: environment.releasedRoot } : {}),
      createId: environment.createId,
      ...(environment.scanner ? { scanner: environment.scanner } : {}),
      ...(environment.now ? { now: environment.now } : {}),
    })
    this.#service = new BrowserSessionService({
      pages: new PlaywrightSessionPages({ policy: environment.policy, downloads, storage }),
      snapshots,
      createId: environment.createId,
      ...(environment.now ? { now: environment.now } : {}),
      // WHY an ask instead of a local decision: the egress allowlist and the
      // audit trail live in the server process. The host holds Chromium, not
      // the policy (ADR-089 §2).
      authorizeNavigation: async (workspaceId, url) => {
        if (!await this.#ask({ request: "authorize", url, workspaceId })) {
          throw new Error(`Browser navigation to ${new URL(url).origin} is not allowed`)
        }
      },
      onChange: (sessionId) => this.#emitSync(sessionId),
    })
  }

  #emitSync(sessionId: string, storage?: BrowserStorageState): void {
    if (this.#closed) return
    // `peek`, not `get`: a session that just closed is still a fact the mirror
    // has to see, and `get` hides it by throwing.
    const session = this.#service.peek(sessionId)
    if (!session) return
    const live = session.status !== "closed"
    this.#send({
      event: "sync",
      session,
      // Activity and downloads belong to a live session; reading them after the
      // close would throw and lose the terminal event too.
      ...(live
        ? { activity: this.#service.activity(sessionId), downloads: this.#service.downloads(sessionId) }
        : { activity: [], downloads: [] }),
      ...(storage ? { storage } : {}),
    })
  }

  #send(message: Outbound): void {
    this.#outbound(encodeFrame(message))
  }

  /** Announces the host once the caller owns the outbound stream. */
  attach(outbound: (line: string) => void): void {
    this.#outbound = outbound
    this.#send({ event: "ready", version: HOST_PROTOCOL_VERSION })
  }

  /** Consumes one inbound line. The stdio entry point feeds it; tests call it directly. */
  async receive(line: string): Promise<void> {
    let frame
    try {
      frame = decodeFrame(line)
    } catch (error) {
      // WHY fatal rather than an error reply: a line that does not parse has no
      // id to answer, so any reply would be uncorrelatable. Only the server
      // writes requests here, so this means the two sides disagree about the
      // protocol. Exiting lets the manager fail every in-flight request with a
      // typed error and restart (ADR-089 §5); staying alive would leave the
      // server waiting on a response that can never arrive.
      this.#onFatal(`malformed frame from the Browser server: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if ("event" in frame) return
    if ("method" in frame) {
      await dispatchHostRequest(this.#service, frame, {
        reply: (reply) => this.#send(reply),
        askApproval: (sessionId, reason) => this.#ask({ request: "approve", reason, sessionId }),
      })
      // After the await, not before: `shutdown` is what produces the terminal
      // syncs, and marking the host closed first would swallow them.
      if (frame.method === "host.shutdown") this.#closed = true
      return
    }
    if ("request" in frame) {
      // Asks only ever travel host -> server. One arriving here means the
      // server has the direction of the protocol backwards.
      this.#onFatal("the Browser server sent an ask, which only the host may send")
      return
    }
    const ask = this.#asks.get(frame.id)
    if (!ask) {
      this.#send({ id: frame.id, error: { name: "BrowserHostProtocolError", message: "response does not match a pending ask" } })
      return
    }
    this.#asks.delete(frame.id)
    const result = frame.result as HostAskResult | undefined
    ask(result?.approved === true)
  }

  #ask(input: HostAskInput): Promise<boolean> {
    const id = this.#nextAskId++
    return new Promise<boolean>((resolve) => {
      this.#asks.set(id, resolve)
      this.#send({ id, ...input })
    })
  }
}

/** stderr only: a line on stdout would be parsed as a frame by the server. */
function defaultOnFatal(reason: string): void {
  process.stderr.write(`unifia-browser-host: ${reason}\n`)
  process.exit(1)
}

export type { HostRequest }
export { HOST_PROTOCOL_VERSION }
